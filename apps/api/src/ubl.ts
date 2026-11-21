/**
 * Lectura de facturas electrónicas de venta colombianas (UBL 2.1, anexo técnico DIAN) para "Soporte por legalizar".
 *
 * Acepta el XML de la factura (raíz <Invoice>) o el contenedor que envía el proveedor por correo (raíz
 * <AttachedDocument>, con la factura dentro de cac:Attachment/cac:ExternalReference/cbc:Description en CDATA).
 *
 * Seguridad: lector propio y mínimo. No resuelve DOCTYPE ni entidades externas (rechaza cualquier <!DOCTYPE>,
 * lo que evita XXE y la expansión exponencial de entidades); solo decodifica las 5 entidades XML y las
 * numéricas. El tamaño lo limita la ruta (MAX_XML_LENGTH).
 */

export const MAX_XML_LENGTH = 2_000_000;

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

const localName = (name: string) => name.slice(name.indexOf(":") + 1);
const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[lower]!;
  });

class XmlError extends Error {}

/** Convierte el texto XML en un árbol con nombres locales (sin prefijo de espacio de nombres). */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  const until = (token: string, from: number) => {
    const at = xml.indexOf(token, from);
    if (at < 0) throw new XmlError("El XML está incompleto o mal formado.");
    return at;
  };
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) {
      top.text += decode(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decode(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) i = until("-->", lt) + 3;
    else if (xml.startsWith("<![CDATA[", lt)) {
      const end = until("]]>", lt);
      top.text += xml.slice(lt + 9, end);
      i = end + 3;
    } else if (xml.startsWith("<?", lt)) i = until("?>", lt) + 2;
    else if (xml.startsWith("<!", lt)) throw new XmlError("El XML no puede declarar DOCTYPE ni entidades.");
    else if (xml.startsWith("</", lt)) {
      const gt = until(">", lt);
      const name = localName(xml.slice(lt + 2, gt).trim());
      const closed = stack.pop();
      if (!closed || closed === root || closed.name !== name)
        throw new XmlError("El XML está mal formado (etiquetas sin cerrar).");
      i = gt + 1;
    } else {
      // Fin de la etiqueta respetando comillas en los atributos.
      let gt = lt + 1;
      let quote = "";
      for (; gt < xml.length; gt++) {
        const char = xml[gt];
        if (quote) quote = char === quote ? "" : quote;
        else if (char === '"' || char === "'") quote = char;
        else if (char === ">") break;
      }
      if (gt >= xml.length) throw new XmlError("El XML está incompleto o mal formado.");
      const selfClosing = xml[gt - 1] === "/";
      const body = xml.slice(lt + 1, selfClosing ? gt - 1 : gt);
      const name = body.match(/^[^\s/>]+/)?.[0];
      if (!name) throw new XmlError("El XML está mal formado.");
      const attrs: Record<string, string> = {};
      for (const match of body.slice(name.length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        attrs[localName(match[1]!)] = decode(match[2] ?? match[3] ?? "");
      const node: XmlNode = { name: localName(name), attrs, children: [], text: "" };
      top.children.push(node);
      if (!selfClosing) stack.push(node);
      i = gt + 1;
    }
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new XmlError("El XML está mal formado.");
  return root.children[0]!;
}

/** Primer hijo que sigue la ruta de nombres locales (p. ej. "AccountingSupplierParty", "Party"). */
export function find(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let current = node;
  for (const name of path) current = current?.children.find(child => child.name === name);
  return current;
}
export const findAll = (node: XmlNode | undefined, name: string) =>
  node?.children.filter(child => child.name === name) ?? [];
export const text = (node: XmlNode | undefined) => node?.text.trim() || undefined;

// ─── Factura electrónica ─────────────────────────────────────────────────────

/** Tipos de documento de identificación DIAN (tabla 13.2.1 del anexo técnico) → abreviatura usada en Betel. */
const identificationTypes: Record<string, string> = {
  "11": "RC",
  "12": "TI",
  "13": "CC",
  "21": "TE",
  "22": "CE",
  "31": "NIT",
  "41": "PA",
  "42": "DIE",
  "47": "PEP",
  "48": "PPT",
  "50": "NIT",
  "91": "NUIP",
};

export type ParsedInvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
  total: number;
};
export type ParsedInvoice = {
  cufe: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  paymentTerm: "CASH" | "CREDIT";
  currency: string;
  supplier: { nit: string; idType: string; name: string };
  customerNit: string;
  lines: ParsedInvoiceLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  /** Mensajes para quien legaliza; `blocking` impide legalizar (el resultado no cuadraría). */
  warnings: { message: string; blocking: boolean }[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const amount = (node: XmlNode | undefined) => {
  const value = Number(text(node));
  return Number.isFinite(value) ? value : NaN;
};
const isDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Lee una factura electrónica (Invoice o AttachedDocument). Lanza Error con un mensaje para el usuario. */
export function parseElectronicInvoice(xml: string): ParsedInvoice {
  let root: XmlNode;
  try {
    root = parseXml(xml.replace(/^﻿/, ""));
    if (root.name === "AttachedDocument") {
      const inner = text(find(root, "Attachment", "ExternalReference", "Description"));
      if (!inner?.includes("Invoice"))
        throw new XmlError("El contenedor (AttachedDocument) no trae una factura electrónica.");
      root = parseXml(inner);
    }
  } catch (error) {
    if (error instanceof XmlError) throw new Error(error.message);
    throw new Error("No se pudo leer el XML.");
  }
  if (root.name !== "Invoice")
    throw new Error(
      root.name === "CreditNote" || root.name === "DebitNote"
        ? "Es una nota crédito o débito: por ahora solo se importan facturas electrónicas de venta."
        : "El archivo no es una factura electrónica (UBL 2.1)."
    );

  const cufe = text(find(root, "UUID"))?.toLowerCase();
  if (!cufe || !/^[0-9a-f]{96}$/.test(cufe))
    throw new Error("La factura no trae un CUFE válido (96 caracteres hexadecimales).");
  const number = text(find(root, "ID"));
  if (!number) throw new Error("La factura no trae su número.");
  const issueDate = text(find(root, "IssueDate"));
  if (!isDate(issueDate)) throw new Error("La factura no trae una fecha de emisión válida.");
  const paymentMeans = find(root, "PaymentMeans");
  const dueDate = [text(find(root, "DueDate")), text(find(paymentMeans, "PaymentDueDate"))].find(isDate) ?? null;
  const paymentTerm = text(find(paymentMeans, "ID")) === "2" ? "CREDIT" : "CASH";
  const currency = text(find(root, "DocumentCurrencyCode")) ?? "COP";

  const party = (role: string) => {
    const node = find(root, role, "Party");
    const scheme = find(node, "PartyTaxScheme");
    const legal = find(node, "PartyLegalEntity");
    const id = find(scheme, "CompanyID") ?? find(legal, "CompanyID");
    return {
      // El dígito de verificación va en el atributo schemeID; si viene pegado con guion, se quita.
      nit: (text(id) ?? "").split("-")[0]!.replace(/\D/g, ""),
      idType: identificationTypes[id?.attrs.schemeName ?? ""] ?? "NIT",
      name:
        text(find(scheme, "RegistrationName")) ??
        text(find(legal, "RegistrationName")) ??
        text(find(node, "PartyName", "Name")) ??
        "",
    };
  };
  const supplier = party("AccountingSupplierParty");
  const customer = party("AccountingCustomerParty");
  if (!supplier.nit || !supplier.name) throw new Error("La factura no identifica al proveedor (NIT y razón social).");
  if (!customer.nit) throw new Error("La factura no identifica al comprador.");

  const warnings: ParsedInvoice["warnings"] = [];
  const lines = findAll(root, "InvoiceLine").map((line, index) => {
    const quantity = amount(find(line, "InvoicedQuantity"));
    const price = amount(find(line, "Price", "PriceAmount"));
    const lineTotal = amount(find(line, "LineExtensionAmount"));
    if (![quantity, price, lineTotal].every(Number.isFinite) || quantity <= 0)
      throw new Error(`El ítem ${index + 1} no trae cantidad, precio o valor válidos.`);
    let taxRate = 0;
    for (const subtotal of findAll(find(line, "TaxTotal"), "TaxSubtotal")) {
      const category = find(subtotal, "TaxCategory");
      const scheme = text(find(category, "TaxScheme", "ID"));
      const percent = Number(text(find(category, "Percent")) ?? 0);
      if (scheme === "01") taxRate = percent;
      else if (amount(find(subtotal, "TaxAmount")) > 0) {
        const name = text(find(category, "TaxScheme", "Name")) ?? scheme;
        warnings.push({
          message: `El ítem ${index + 1} trae el impuesto ${name}; Betel solo contabiliza IVA en compras.`,
          blocking: true,
        });
      }
    }
    // Descuento del ítem: diferencia entre cantidad × precio y el valor del ítem.
    const gross = quantity * price;
    const discountRate = gross > 0 && lineTotal < gross ? round2((1 - lineTotal / gross) * 100) : 0;
    if (lineTotal > gross + 0.01)
      warnings.push({ message: `El ítem ${index + 1} trae cargos adicionales que Betel no registra.`, blocking: true });
    return {
      description: (text(find(line, "Item", "Description")) ?? `Ítem ${index + 1}`).slice(0, 500),
      quantity,
      unitPrice: round2(price),
      discountRate,
      taxRate,
      total: round2(lineTotal * (1 + taxRate / 100)),
    };
  });
  if (!lines.length) throw new Error("La factura no trae ítems.");

  const totals = find(root, "LegalMonetaryTotal");
  const subtotal = amount(find(totals, "LineExtensionAmount"));
  const total = amount(find(totals, "TaxInclusiveAmount"));
  if (!Number.isFinite(subtotal) || !Number.isFinite(total)) throw new Error("La factura no trae sus totales.");
  const taxTotal = round2(total - subtotal);

  if (currency !== "COP")
    warnings.push({
      message: `La factura está en ${currency}; Betel registra compras solo en pesos (COP).`,
      blocking: true,
    });
  if (findAll(root, "WithholdingTaxTotal").length)
    warnings.push({
      message: "La factura informa retenciones; Betel aún no las contabiliza en compras (regístralas aparte).",
      blocking: false,
    });
  const charges = findAll(root, "AllowanceCharge").filter(item => amount(find(item, "Amount")) > 0);
  if (charges.length)
    warnings.push({ message: "La factura trae descuentos o cargos globales que Betel no registra.", blocking: true });
  if (paymentTerm === "CREDIT" && !dueDate)
    warnings.push({ message: "Es a crédito y no trae fecha de vencimiento: indícala al legalizar.", blocking: false });

  return {
    cufe,
    number: number.slice(0, 40),
    issueDate,
    dueDate,
    paymentTerm,
    currency,
    supplier: { ...supplier, name: supplier.name.slice(0, 200) },
    customerNit: customer.nit,
    lines,
    subtotal: round2(subtotal),
    taxTotal,
    total: round2(total),
    warnings,
  };
}
