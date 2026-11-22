/**
 * Catálogo de reportes › Ventas, cotizaciones, recibos de caja, remisiones y facturación electrónica.
 * Ventas = facturas emitidas vigentes (ISSUED, ACCEPTED, OVERDUE) por fecha de emisión; "base" es el valor antes de
 * IVA y después de descuentos. Vendedor = usuario responsable de la factura (AuditLog CREATE_DRAFT).
 */
import { Prisma } from "@betel/db";
import {
  accumulate,
  BILLED,
  type CatalogReport,
  invoiceLabel,
  iso,
  lineAmounts,
  money,
  monthNames,
  NO_SELLER,
  percent,
  qty,
  sellersOf,
  type Tx,
  VIEW,
  yearRange,
  ZERO,
} from "./common.js";

const lineSelect = {
  quantity: true,
  unitPrice: true,
  discountRate: true,
  lineTotal: true,
  description: true,
  productId: true,
  product: { select: { sku: true, name: true, unitPrice: true } },
  invoice: {
    select: {
      id: true,
      prefix: true,
      number: true,
      issueDate: true,
      customerId: true,
      customer: { select: { legalName: true, identificationNumber: true } },
    },
  },
} satisfies Prisma.InvoiceLineSelect;

async function salesLines(tx: Tx, issueDate: Prisma.DateTimeFilter) {
  return tx.invoiceLine.findMany({
    where: { invoice: { status: { in: [...BILLED] }, issueDate } },
    select: lineSelect,
    orderBy: { invoice: { issueDate: "asc" } },
  });
}
type SalesLine = Awaited<ReturnType<typeof salesLines>>[number];

const productKey = (line: SalesLine) => line.productId ?? "free";
const productCode = (line: SalesLine) => line.product?.sku ?? "—";
const productName = (line: SalesLine) => line.product?.name ?? "Ítems sin producto del catálogo";

type Bucket = { quantity: Prisma.Decimal; base: Prisma.Decimal; tax: Prisma.Decimal };
const emptyBucket = (): Bucket => ({ quantity: ZERO, base: ZERO, tax: ZERO });
const addLine = (bucket: Bucket, line: SalesLine) => {
  const { base, tax } = lineAmounts(line);
  bucket.quantity = bucket.quantity.plus(line.quantity);
  bucket.base = bucket.base.plus(base);
  bucket.tax = bucket.tax.plus(tax);
};

const byBase = <T extends { base: Prisma.Decimal }>(a: T, b: T) => b.base.comparedTo(a.base);

const salesByProduct: CatalogReport = {
  id: "ventas-por-producto",
  title: "Ventas por producto",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const lines = await salesLines(tx, { gte: from, lte: to });
    const groups = accumulate(
      lines,
      productKey,
      line => ({ code: productCode(line), name: productName(line), ...emptyBucket() }),
      addLine
    );
    const total = [...groups.values()].reduce((sum, row) => sum.plus(row.base), ZERO);
    return {
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Producto" },
        { key: "quantity", label: "Cantidad", type: "number" },
        { key: "base", label: "Ventas antes de IVA", type: "money" },
        { key: "tax", label: "IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
        { key: "share", label: "Participación %", type: "percent" },
      ],
      rows: [...groups.values()].sort(byBase).map(row => ({
        code: row.code,
        name: row.name,
        quantity: qty(row.quantity),
        base: money(row.base),
        tax: money(row.tax),
        total: money(row.base.plus(row.tax)),
        share: percent(row.base, total),
      })),
    };
  },
};

const salesByCustomer: CatalogReport = {
  id: "ventas-por-cliente",
  title: "Ventas por cliente",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const invoices = await tx.invoice.findMany({
      where: { status: { in: [...BILLED] }, issueDate: { gte: from, lte: to } },
      select: {
        customerId: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        total: true,
        customer: { select: { legalName: true, identificationNumber: true } },
      },
    });
    const groups = accumulate(
      invoices,
      invoice => invoice.customerId,
      invoice => ({ ...invoice.customer, count: 0, base: ZERO, tax: ZERO, total: ZERO }),
      (acc, invoice) => {
        acc.count += 1;
        acc.base = acc.base.plus(invoice.subtotal.minus(invoice.discountTotal));
        acc.tax = acc.tax.plus(invoice.taxTotal);
        acc.total = acc.total.plus(invoice.total);
      }
    );
    return {
      columns: [
        { key: "name", label: "Cliente" },
        { key: "nit", label: "Identificación" },
        { key: "count", label: "Facturas", type: "number" },
        { key: "base", label: "Ventas antes de IVA", type: "money" },
        { key: "tax", label: "IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
      ],
      rows: [...groups.values()].sort(byBase).map(row => ({
        name: row.legalName,
        nit: row.identificationNumber,
        count: row.count,
        base: money(row.base),
        tax: money(row.tax),
        total: money(row.total),
      })),
    };
  },
};

const salesBySeller: CatalogReport = {
  id: "ventas-por-vendedor",
  title: "Ventas por vendedor",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const invoices = await tx.invoice.findMany({
      where: { status: { in: [...BILLED] }, issueDate: { gte: from, lte: to } },
      select: { id: true, subtotal: true, discountTotal: true, taxTotal: true, total: true },
    });
    const sellers = await sellersOf(
      tx,
      invoices.map(invoice => invoice.id)
    );
    const groups = accumulate(
      invoices,
      invoice => sellers.get(invoice.id) ?? NO_SELLER,
      invoice => ({ seller: sellers.get(invoice.id) ?? NO_SELLER, count: 0, base: ZERO, tax: ZERO, total: ZERO }),
      (acc, invoice) => {
        acc.count += 1;
        acc.base = acc.base.plus(invoice.subtotal.minus(invoice.discountTotal));
        acc.tax = acc.tax.plus(invoice.taxTotal);
        acc.total = acc.total.plus(invoice.total);
      }
    );
    const total = [...groups.values()].reduce((sum, row) => sum.plus(row.base), ZERO);
    return {
      columns: [
        { key: "seller", label: "Vendedor" },
        { key: "count", label: "Facturas", type: "number" },
        { key: "base", label: "Ventas antes de IVA", type: "money" },
        { key: "tax", label: "IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
        { key: "share", label: "Participación %", type: "percent" },
      ],
      rows: [...groups.values()].sort(byBase).map(row => ({
        seller: row.seller,
        count: row.count,
        base: money(row.base),
        tax: money(row.tax),
        total: money(row.total),
        share: percent(row.base, total),
      })),
      notes: ["Vendedor: usuario que creó la factura (el mismo «Usuario responsable» del reporte de facturación)."],
    };
  },
};

const salesByCustomerProduct: CatalogReport = {
  id: "ventas-cliente-producto",
  title: "Ventas por cliente por producto",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const lines = await salesLines(tx, { gte: from, lte: to });
    const groups = accumulate(
      lines,
      line => `${line.invoice.customerId}|${productKey(line)}`,
      line => ({
        customer: line.invoice.customer.legalName,
        code: productCode(line),
        name: productName(line),
        ...emptyBucket(),
      }),
      addLine
    );
    return {
      columns: [
        { key: "customer", label: "Cliente" },
        { key: "code", label: "Código" },
        { key: "name", label: "Producto" },
        { key: "quantity", label: "Cantidad", type: "number" },
        { key: "base", label: "Ventas antes de IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => a.customer.localeCompare(b.customer, "es") || b.base.comparedTo(a.base))
        .map(row => ({
          customer: row.customer,
          code: row.code,
          name: row.name,
          quantity: qty(row.quantity),
          base: money(row.base),
          total: money(row.base.plus(row.tax)),
        })),
    };
  },
};

const salesBySellerProduct: CatalogReport = {
  id: "ventas-vendedor-producto",
  title: "Ventas por vendedor por producto",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const lines = await salesLines(tx, { gte: from, lte: to });
    const sellers = await sellersOf(tx, [...new Set(lines.map(line => line.invoice.id))]);
    const seller = (line: SalesLine) => sellers.get(line.invoice.id) ?? NO_SELLER;
    const groups = accumulate(
      lines,
      line => `${seller(line)}|${productKey(line)}`,
      line => ({ seller: seller(line), code: productCode(line), name: productName(line), ...emptyBucket() }),
      addLine
    );
    return {
      columns: [
        { key: "seller", label: "Vendedor" },
        { key: "code", label: "Código" },
        { key: "name", label: "Producto" },
        { key: "quantity", label: "Cantidad", type: "number" },
        { key: "base", label: "Ventas antes de IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => a.seller.localeCompare(b.seller, "es") || b.base.comparedTo(a.base))
        .map(row => ({
          seller: row.seller,
          code: row.code,
          name: row.name,
          quantity: qty(row.quantity),
          base: money(row.base),
          total: money(row.base.plus(row.tax)),
        })),
    };
  },
};

const salesMonthComparison: CatalogReport = {
  id: "comparativo-ventas-mes",
  title: "Comparativo de ventas por mes",
  params: ["year"],
  roles: VIEW,
  async run(tx, { year }) {
    const invoices = await tx.invoice.findMany({
      where: { status: { in: [...BILLED] }, issueDate: { gte: yearRange(year - 1).gte, lte: yearRange(year).lte } },
      select: { issueDate: true, subtotal: true, discountTotal: true },
    });
    const sums = new Map<string, Prisma.Decimal>();
    for (const invoice of invoices) {
      const key = invoice.issueDate.toISOString().slice(0, 7);
      sums.set(key, (sums.get(key) ?? ZERO).plus(invoice.subtotal.minus(invoice.discountTotal)));
    }
    const month = (y: number, m: number) => sums.get(`${y}-${String(m + 1).padStart(2, "0")}`) ?? ZERO;
    return {
      columns: [
        { key: "month", label: "Mes" },
        { key: "current", label: `Ventas ${year}`, type: "money" },
        { key: "previous", label: `Ventas ${year - 1}`, type: "money" },
        { key: "difference", label: "Diferencia", type: "money" },
        { key: "change", label: "Variación %", type: "percent" },
      ],
      rows: monthNames.map((name, index) => {
        const current = month(year, index);
        const previous = month(year - 1, index);
        return {
          month: name,
          current: money(current),
          previous: money(previous),
          difference: money(current.minus(previous)),
          change: previous.isZero() ? null : current.minus(previous).dividedBy(previous).times(100).toFixed(1),
        };
      }),
      notes: ["Ventas antes de IVA de las facturas emitidas vigentes."],
    };
  },
};

/** Comparativo de 12 meses por una dimensión (producto o vendedor). */
function monthlyBy(id: string, title: string, dimension: "product" | "seller"): CatalogReport {
  return {
    id,
    title,
    params: ["year"],
    roles: VIEW,
    async run(tx, { year }) {
      const lines = await salesLines(tx, yearRange(year));
      const sellers =
        dimension === "seller" ? await sellersOf(tx, [...new Set(lines.map(line => line.invoice.id))]) : null;
      const label = (line: SalesLine) =>
        dimension === "seller"
          ? (sellers!.get(line.invoice.id) ?? NO_SELLER)
          : `${productCode(line)} · ${productName(line)}`;
      const groups = accumulate(
        lines,
        line => (dimension === "seller" ? label(line) : productKey(line)),
        line => ({ label: label(line), months: monthNames.map(() => ZERO), total: ZERO }),
        (acc, line) => {
          const { base } = lineAmounts(line);
          const index = line.invoice.issueDate.getUTCMonth();
          acc.months[index] = acc.months[index]!.plus(base);
          acc.total = acc.total.plus(base);
        }
      );
      return {
        columns: [
          { key: "label", label: dimension === "seller" ? "Vendedor" : "Producto" },
          ...monthNames.map((name, index) => ({ key: `m${index}`, label: name, type: "money" as const })),
          { key: "total", label: "Total", type: "money" },
        ],
        rows: [...groups.values()]
          .sort((a, b) => b.total.comparedTo(a.total))
          .map(row => ({
            label: row.label,
            ...Object.fromEntries(row.months.map((value, index) => [`m${index}`, money(value)])),
            total: money(row.total),
          })),
        notes: [`Ventas antes de IVA de ${year} por mes.`],
      };
    },
  };
}

const gifts: CatalogReport = {
  id: "obsequios",
  title: "Informe facturación de obsequios",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const lines = await tx.invoiceLine.findMany({
      where: {
        invoice: { status: { in: [...BILLED] }, issueDate: { gte: from, lte: to } },
        OR: [{ unitPrice: 0 }, { discountRate: 100 }],
      },
      select: lineSelect,
      orderBy: { invoice: { issueDate: "asc" } },
    });
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "invoice", label: "Factura" },
        { key: "customer", label: "Cliente" },
        { key: "product", label: "Producto" },
        { key: "quantity", label: "Cantidad", type: "number" },
        { key: "listPrice", label: "Precio de lista", type: "money", sum: false },
        { key: "value", label: "Valor comercial", type: "money" },
      ],
      rows: lines.map(line => {
        const listPrice = line.product?.unitPrice ?? line.unitPrice;
        return {
          date: iso(line.invoice.issueDate),
          invoice: invoiceLabel(line.invoice),
          customer: line.invoice.customer.legalName,
          product: line.product ? `${line.product.sku ?? ""} ${line.product.name}`.trim() : line.description,
          quantity: qty(line.quantity),
          listPrice: money(listPrice),
          value: money(line.quantity.times(listPrice)),
        };
      }),
      notes: [
        "Obsequio: renglón facturado sin valor (precio cero o descuento del 100 %). El valor comercial usa el precio de lista del producto.",
      ],
    };
  },
};

const quotesBySeller: CatalogReport = {
  id: "cotizaciones-por-vendedor",
  title: "Cotizaciones por vendedor",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const quotes = await tx.quote.findMany({
      where: { issueDate: { gte: from, lte: to } },
      select: { status: true, total: true, createdBy: { select: { displayName: true, email: true } } },
    });
    const groups = accumulate(
      quotes,
      quote => quote.createdBy?.displayName || quote.createdBy?.email || NO_SELLER,
      quote => ({
        seller: quote.createdBy?.displayName || quote.createdBy?.email || NO_SELLER,
        count: 0,
        open: 0,
        invoiced: 0,
        voided: 0,
        value: ZERO,
        invoicedValue: ZERO,
      }),
      (acc, quote) => {
        acc.count += 1;
        if (quote.status === "OPEN") acc.open += 1;
        if (quote.status === "INVOICED") {
          acc.invoiced += 1;
          acc.invoicedValue = acc.invoicedValue.plus(quote.total);
        }
        if (quote.status === "VOID") acc.voided += 1;
        else acc.value = acc.value.plus(quote.total);
      }
    );
    return {
      columns: [
        { key: "seller", label: "Vendedor" },
        { key: "count", label: "Cotizaciones", type: "number" },
        { key: "open", label: "Abiertas", type: "number" },
        { key: "invoiced", label: "Facturadas", type: "number" },
        { key: "voided", label: "Anuladas", type: "number" },
        { key: "value", label: "Valor cotizado", type: "money" },
        { key: "invoicedValue", label: "Valor facturado", type: "money" },
        { key: "conversion", label: "Conversión %", type: "percent" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => b.value.comparedTo(a.value))
        .map(row => ({
          ...row,
          value: money(row.value),
          invoicedValue: money(row.invoicedValue),
          conversion: row.count - row.voided ? ((row.invoiced / (row.count - row.voided)) * 100).toFixed(1) : null,
        })),
      notes: ["Valor cotizado sin las anuladas. Conversión = facturadas / (cotizaciones − anuladas)."],
    };
  },
};

const dianStatusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  QUEUED: "En cola",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  ERROR: "Error",
};

const electronicInvoices: CatalogReport = {
  id: "facturacion-electronica",
  title: "Informes facturación electrónica",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const invoices = await tx.invoice.findMany({
      where: { status: { not: "DRAFT" }, issueDate: { gte: from, lte: to } },
      select: {
        prefix: true,
        number: true,
        issueDate: true,
        total: true,
        status: true,
        dianStatus: true,
        cufe: true,
        customer: { select: { legalName: true, identificationNumber: true } },
      },
      orderBy: [{ issueDate: "asc" }, { number: "asc" }],
    });
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "invoice", label: "Factura" },
        { key: "customer", label: "Cliente" },
        { key: "nit", label: "Identificación" },
        { key: "total", label: "Total", type: "money" },
        { key: "dian", label: "Estado DIAN" },
        { key: "cufe", label: "CUFE" },
      ],
      rows: invoices.map(invoice => ({
        date: iso(invoice.issueDate),
        invoice: invoiceLabel(invoice),
        customer: invoice.customer.legalName,
        nit: invoice.customer.identificationNumber,
        total: money(invoice.status === "VOID" ? 0 : invoice.total),
        dian: dianStatusLabels[invoice.dianStatus] ?? invoice.dianStatus,
        cufe: invoice.cufe ?? "—",
      })),
      notes: ["Las facturas anuladas aparecen con total cero. En el ambiente de pruebas los envíos quedan en cola."],
    };
  },
};

const methodLabels: Record<string, string> = {
  CASH: "Efectivo",
  BANK_TRANSFER: "Transferencia o consignación",
  CARD: "Tarjeta",
  CHECK: "Cheque",
  ONLINE: "Pago en línea",
  OTHER: "Otro",
};
export const methodLabel = (method: string | null) => (method ? (methodLabels[method] ?? method) : "—");

const receiptsByInvoice: CatalogReport = {
  id: "recibos-por-factura",
  title: "Recibos de caja detallado por facturas",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const applications = await tx.cashReceiptApplication.findMany({
      where: { receipt: { status: "ACTIVE", date: { gte: from, lte: to } } },
      select: {
        amount: true,
        receipt: { select: { number: true, date: true, method: true, customer: { select: { legalName: true } } } },
        invoice: { select: { prefix: true, number: true, total: true } },
      },
      orderBy: [{ receipt: { date: "asc" } }, { receipt: { number: "asc" } }],
    });
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "receipt", label: "Recibo" },
        { key: "customer", label: "Cliente" },
        { key: "method", label: "Forma de pago" },
        { key: "invoice", label: "Factura" },
        { key: "invoiceTotal", label: "Total factura", type: "money", sum: false },
        { key: "amount", label: "Valor aplicado", type: "money" },
      ],
      rows: applications.map(item => ({
        date: iso(item.receipt.date),
        receipt: `RC-${item.receipt.number}`,
        customer: item.receipt.customer.legalName,
        method: methodLabel(item.receipt.method),
        invoice: invoiceLabel(item.invoice),
        invoiceTotal: money(item.invoice.total),
        amount: money(item.amount),
      })),
    };
  },
};

/** Facturas emitidas vigentes con base gravada, exenta, IVA, abonos y saldo. */
async function invoiceBook(tx: Tx, from: Date, to: Date) {
  return tx.invoice.findMany({
    where: { status: { in: [...BILLED] }, issueDate: { gte: from, lte: to } },
    select: {
      prefix: true,
      number: true,
      issueDate: true,
      paymentTerm: true,
      total: true,
      taxTotal: true,
      customer: { select: { legalName: true, identificationNumber: true } },
      lines: { select: { quantity: true, unitPrice: true, discountRate: true, lineTotal: true, taxRate: true } },
      receiptApplications: { where: { receipt: { status: "ACTIVE" } }, select: { amount: true } },
    },
    orderBy: [{ issueDate: "asc" }, { number: "asc" }],
  });
}
const taxedBases = (lines: Awaited<ReturnType<typeof invoiceBook>>[number]["lines"]) =>
  lines.reduce(
    (acc, line) => {
      const { base } = lineAmounts(line);
      if (line.taxRate.isZero()) acc.exempt = acc.exempt.plus(base);
      else acc.taxed = acc.taxed.plus(base);
      return acc;
    },
    { taxed: ZERO, exempt: ZERO }
  );

const invoiceMovement: CatalogReport = {
  id: "movimiento-facturas-venta",
  title: "Movimiento facturas de venta / Ingresos",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const invoices = await invoiceBook(tx, from, to);
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "invoice", label: "Factura" },
        { key: "customer", label: "Cliente" },
        { key: "term", label: "Forma de pago" },
        { key: "base", label: "Base", type: "money" },
        { key: "tax", label: "IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
        { key: "paid", label: "Abonado", type: "money" },
        { key: "balance", label: "Saldo", type: "money" },
      ],
      rows: invoices.map(invoice => {
        const paid =
          invoice.paymentTerm === "CASH"
            ? invoice.total
            : invoice.receiptApplications.reduce((sum, item) => sum.plus(item.amount), ZERO);
        return {
          date: iso(invoice.issueDate),
          invoice: invoiceLabel(invoice),
          customer: invoice.customer.legalName,
          term: invoice.paymentTerm === "CASH" ? "Contado" : "Crédito",
          base: money(invoice.total.minus(invoice.taxTotal)),
          tax: money(invoice.taxTotal),
          total: money(invoice.total),
          paid: money(paid),
          balance: money(invoice.total.minus(paid)),
        };
      }),
      notes: ["Facturas emitidas vigentes; las de contado se consideran pagadas al emitirse."],
    };
  },
};

const salesBook: CatalogReport = {
  id: "libro-ventas",
  title: "Libro oficial de ventas",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const invoices = await invoiceBook(tx, from, to);
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "invoice", label: "Factura" },
        { key: "customer", label: "Cliente" },
        { key: "nit", label: "NIT / Identificación" },
        { key: "taxed", label: "Base gravada", type: "money" },
        { key: "exempt", label: "Exenta / excluida", type: "money" },
        { key: "tax", label: "IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
      ],
      rows: invoices.map(invoice => {
        const bases = taxedBases(invoice.lines);
        return {
          date: iso(invoice.issueDate),
          invoice: invoiceLabel(invoice),
          customer: invoice.customer.legalName,
          nit: invoice.customer.identificationNumber,
          taxed: money(bases.taxed),
          exempt: money(bases.exempt),
          tax: money(invoice.taxTotal),
          total: money(invoice.total),
        };
      }),
    };
  },
};

const deliveryStatus: Record<string, string> = { OPEN: "Abierta", INVOICED: "Facturada", VOID: "Anulada" };
const crossedDeliveries: CatalogReport = {
  id: "remisiones-cruzadas",
  title: "Informe de remisiones cruzadas",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const deliveries = await tx.delivery.findMany({
      where: { issueDate: { gte: from, lte: to } },
      select: {
        number: true,
        issueDate: true,
        status: true,
        total: true,
        customer: { select: { legalName: true } },
        invoice: { select: { prefix: true, number: true, status: true, issueDate: true, total: true } },
      },
      orderBy: { number: "asc" },
    });
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "delivery", label: "Remisión" },
        { key: "customer", label: "Cliente" },
        { key: "status", label: "Estado" },
        { key: "total", label: "Valor remisión", type: "money" },
        { key: "invoice", label: "Factura" },
        { key: "invoiceTotal", label: "Valor factura", type: "money" },
        { key: "difference", label: "Diferencia", type: "money" },
      ],
      rows: deliveries.map(delivery => {
        const invoiceTotal = delivery.invoice && delivery.invoice.status !== "VOID" ? delivery.invoice.total : null;
        return {
          date: iso(delivery.issueDate),
          delivery: `REM-${delivery.number}`,
          customer: delivery.customer.legalName,
          status: deliveryStatus[delivery.status] ?? delivery.status,
          total: money(delivery.status === "VOID" ? 0 : delivery.total),
          invoice: delivery.invoice
            ? delivery.invoice.status === "DRAFT"
              ? "Borrador"
              : invoiceLabel(delivery.invoice)
            : "Sin facturar",
          invoiceTotal: invoiceTotal ? money(invoiceTotal) : null,
          difference: invoiceTotal ? money(invoiceTotal.minus(delivery.total)) : null,
        };
      }),
      notes: ["Cruce de cada remisión con la factura creada desde ella. Las anuladas suman cero."],
    };
  },
};

export const salesReports: CatalogReport[] = [
  quotesBySeller,
  salesByCustomer,
  salesByProduct,
  salesBySeller,
  salesByCustomerProduct,
  salesBySellerProduct,
  salesMonthComparison,
  monthlyBy("comparativo-ventas-producto", "Comparativo de ventas por producto", "product"),
  monthlyBy("comparativo-ventas-vendedor", "Comparativo de ventas por vendedor", "seller"),
  gifts,
  electronicInvoices,
  receiptsByInvoice,
  invoiceMovement,
  salesBook,
  crossedDeliveries,
];
