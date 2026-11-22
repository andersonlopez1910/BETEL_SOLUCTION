/**
 * Catálogo de reportes › Clientes y proveedores (cuentas por cobrar y por pagar, recibos, terceros) y Compras y gastos.
 * Cuentas por cobrar: facturas a crédito emitidas vigentes menos recibos de caja activos (como Gestión de cobro).
 * Cuentas por pagar: compras y gastos a crédito vigentes menos comprobantes de egreso activos (como Proveedores).
 */
import { Prisma } from "@betel/db";
import { agingBucket } from "../payables.js";
import { daysOverdue } from "../portfolio.js";
import {
  accumulate,
  BILLED,
  type CatalogReport,
  invoiceLabel,
  iso,
  LEDGER,
  lineAmounts,
  money,
  qty,
  type Row,
  type Tx,
  VIEW,
  ZERO,
} from "./common.js";
import { methodLabel } from "./sales.js";

type OpenDocument = {
  partyId: string;
  party: string;
  nit: string;
  document: string;
  date: Date;
  dueDate: Date | null;
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
};

/** Documentos a crédito con saldo de clientes o proveedores; `until` limita fechas de documentos y pagos (corte). */
async function openDocuments(tx: Tx, kind: "CUSTOMER" | "SUPPLIER", until?: Date): Promise<OpenDocument[]> {
  if (kind === "CUSTOMER") {
    const invoices = await tx.invoice.findMany({
      where: { paymentTerm: "CREDIT", status: { in: [...BILLED] }, ...(until && { issueDate: { lte: until } }) },
      select: {
        customerId: true,
        prefix: true,
        number: true,
        issueDate: true,
        dueDate: true,
        total: true,
        customer: { select: { legalName: true, identificationNumber: true } },
        receiptApplications: {
          where: { receipt: { status: "ACTIVE", ...(until && { date: { lte: until } }) } },
          select: { amount: true },
        },
      },
      orderBy: [{ issueDate: "asc" }, { number: "asc" }],
    });
    return invoices
      .map(invoice => ({
        partyId: invoice.customerId,
        party: invoice.customer.legalName,
        nit: invoice.customer.identificationNumber,
        document: invoiceLabel(invoice),
        date: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: invoice.total,
        paid: invoice.receiptApplications.reduce((sum, item) => sum.plus(item.amount), ZERO),
      }))
      .filter(document => document.total.greaterThan(document.paid));
  }
  const purchases = await tx.purchaseDocument.findMany({
    where: { paymentTerm: "CREDIT", status: "ACTIVE", ...(until && { issueDate: { lte: until } }) },
    select: {
      supplierId: true,
      number: true,
      supplierInvoiceNumber: true,
      issueDate: true,
      dueDate: true,
      total: true,
      supplier: { select: { legalName: true, identificationNumber: true } },
      paymentApplications: {
        where: { payment: { status: "ACTIVE", ...(until && { date: { lte: until } }) } },
        select: { amount: true },
      },
    },
    orderBy: [{ issueDate: "asc" }, { number: "asc" }],
  });
  return purchases
    .map(purchase => ({
      partyId: purchase.supplierId,
      party: purchase.supplier.legalName,
      nit: purchase.supplier.identificationNumber,
      document: `CG-${purchase.number} (${purchase.supplierInvoiceNumber})`,
      date: purchase.issueDate,
      dueDate: purchase.dueDate,
      total: purchase.total,
      paid: purchase.paymentApplications.reduce((sum, item) => sum.plus(item.amount), ZERO),
    }))
    .filter(document => document.total.greaterThan(document.paid));
}

const partyWord = (kind: "CUSTOMER" | "SUPPLIER") => (kind === "CUSTOMER" ? "Cliente" : "Proveedor");

const generalBalance: CatalogReport = {
  id: "cartera-general",
  title: "Cuentas por cobrar/pagar general por cliente/proveedor",
  params: ["partyKind", "date"],
  roles: LEDGER,
  async run(tx, { partyKind, date }) {
    const documents = await openDocuments(tx, partyKind, date);
    const groups = accumulate(
      documents,
      document => document.partyId,
      document => ({
        party: document.party,
        nit: document.nit,
        count: 0,
        total: ZERO,
        paid: ZERO,
        overdue: ZERO,
        upcoming: ZERO,
      }),
      (acc, document) => {
        const balance = document.total.minus(document.paid);
        acc.count += 1;
        acc.total = acc.total.plus(document.total);
        acc.paid = acc.paid.plus(document.paid);
        if (daysOverdue(document.dueDate, date) > 0) acc.overdue = acc.overdue.plus(balance);
        else acc.upcoming = acc.upcoming.plus(balance);
      }
    );
    return {
      columns: [
        { key: "party", label: partyWord(partyKind) },
        { key: "nit", label: "Identificación" },
        { key: "count", label: "Documentos", type: "number" },
        { key: "total", label: "Valor documentos", type: "money" },
        { key: "paid", label: "Abonado", type: "money" },
        { key: "balance", label: "Saldo", type: "money" },
        { key: "overdue", label: "Vencido", type: "money" },
        { key: "upcoming", label: "Por vencer", type: "money" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => b.total.minus(b.paid).comparedTo(a.total.minus(a.paid)))
        .map(row => ({
          party: row.party,
          nit: row.nit,
          count: row.count,
          total: money(row.total),
          paid: money(row.paid),
          balance: money(row.total.minus(row.paid)),
          overdue: money(row.overdue),
          upcoming: money(row.upcoming),
        })),
      notes: ["Documentos a crédito con saldo a la fecha de corte (abonos registrados hasta ese día)."],
    };
  },
};

const detailedBalance: CatalogReport = {
  id: "cartera-por-documento",
  title: "Cuentas por cobrar/pagar detallada por documento",
  params: ["partyKind", "date"],
  roles: LEDGER,
  async run(tx, { partyKind, date }) {
    const documents = await openDocuments(tx, partyKind, date);
    return {
      columns: [
        { key: "party", label: partyWord(partyKind) },
        { key: "document", label: "Documento" },
        { key: "date", label: "Fecha", type: "date" },
        { key: "due", label: "Vence", type: "date" },
        { key: "total", label: "Valor", type: "money" },
        { key: "paid", label: "Abonado", type: "money" },
        { key: "balance", label: "Saldo", type: "money" },
        { key: "days", label: "Días de mora", type: "number", sum: false },
      ],
      rows: documents
        .sort((a, b) => a.party.localeCompare(b.party, "es") || a.date.getTime() - b.date.getTime())
        .map(document => ({
          party: document.party,
          document: document.document,
          date: iso(document.date),
          due: document.dueDate ? iso(document.dueDate) : null,
          total: money(document.total),
          paid: money(document.paid),
          balance: money(document.total.minus(document.paid)),
          days: daysOverdue(document.dueDate, date),
        })),
    };
  },
};

const agingAtDate: CatalogReport = {
  id: "cartera-corte",
  title: "Cuentas por cobrar con corte a una fecha",
  params: ["date"],
  roles: LEDGER,
  async run(tx, { date }) {
    const documents = await openDocuments(tx, "CUSTOMER", date);
    const buckets = ["current", "d1_30", "d31_60", "d61_90", "d90"] as const;
    return {
      columns: [
        { key: "party", label: "Cliente" },
        { key: "document", label: "Factura" },
        { key: "date", label: "Fecha", type: "date" },
        { key: "due", label: "Vence", type: "date" },
        { key: "balance", label: "Saldo al corte", type: "money" },
        { key: "current", label: "Sin vencer", type: "money" },
        { key: "d1_30", label: "1 a 30 días", type: "money" },
        { key: "d31_60", label: "31 a 60 días", type: "money" },
        { key: "d61_90", label: "61 a 90 días", type: "money" },
        { key: "d90", label: "Más de 90 días", type: "money" },
      ],
      rows: documents.map(document => {
        const balance = document.total.minus(document.paid);
        const bucket = agingBucket(daysOverdue(document.dueDate, date));
        return {
          party: document.party,
          document: document.document,
          date: iso(document.date),
          due: document.dueDate ? iso(document.dueDate) : null,
          balance: money(balance),
          ...Object.fromEntries(buckets.map(key => [key, money(key === bucket ? balance : 0)])),
        };
      }),
      notes: [
        "Saldo de cada factura a crédito con las facturas y los recibos de caja registrados hasta la fecha de corte.",
      ],
    };
  },
};

type Movement = {
  date: Date;
  party: string;
  document: string;
  kind: string;
  charge: Prisma.Decimal;
  payment: Prisma.Decimal;
};

async function movements(tx: Tx, kind: "CUSTOMER" | "SUPPLIER", from: Date, to: Date): Promise<Movement[]> {
  if (kind === "CUSTOMER") {
    const [invoices, receipts] = await Promise.all([
      tx.invoice.findMany({
        where: { paymentTerm: "CREDIT", status: { in: [...BILLED] }, issueDate: { gte: from, lte: to } },
        select: { prefix: true, number: true, issueDate: true, total: true, customer: { select: { legalName: true } } },
      }),
      tx.cashReceipt.findMany({
        where: { status: "ACTIVE", date: { gte: from, lte: to } },
        select: { number: true, date: true, total: true, customer: { select: { legalName: true } } },
      }),
    ]);
    return [
      ...invoices.map(invoice => ({
        date: invoice.issueDate,
        party: invoice.customer.legalName,
        document: invoiceLabel(invoice),
        kind: "Factura de venta",
        charge: invoice.total,
        payment: ZERO,
      })),
      ...receipts.map(receipt => ({
        date: receipt.date,
        party: receipt.customer.legalName,
        document: `RC-${receipt.number}`,
        kind: "Recibo de caja",
        charge: ZERO,
        payment: receipt.total,
      })),
    ];
  }
  const [purchases, payments] = await Promise.all([
    tx.purchaseDocument.findMany({
      where: { paymentTerm: "CREDIT", status: "ACTIVE", issueDate: { gte: from, lte: to } },
      select: { number: true, issueDate: true, total: true, supplier: { select: { legalName: true } } },
    }),
    tx.supplierPayment.findMany({
      where: { status: "ACTIVE", date: { gte: from, lte: to } },
      select: { number: true, date: true, total: true, supplier: { select: { legalName: true } } },
    }),
  ]);
  return [
    ...purchases.map(purchase => ({
      date: purchase.issueDate,
      party: purchase.supplier.legalName,
      document: `CG-${purchase.number}`,
      kind: "Compra o gasto",
      charge: purchase.total,
      payment: ZERO,
    })),
    ...payments.map(payment => ({
      date: payment.date,
      party: payment.supplier.legalName,
      document: `CE-${payment.number}`,
      kind: "Comprobante de egreso",
      charge: ZERO,
      payment: payment.total,
    })),
  ];
}

const balanceMovement: CatalogReport = {
  id: "movimiento-cartera",
  title: "Movimiento de cuentas por cobrar/pagar por documento",
  params: ["partyKind", "period"],
  roles: LEDGER,
  async run(tx, { partyKind, from, to }) {
    const rows = (await movements(tx, partyKind, from, to)).sort(
      (a, b) => a.party.localeCompare(b.party, "es") || a.date.getTime() - b.date.getTime()
    );
    return {
      columns: [
        { key: "party", label: partyWord(partyKind) },
        { key: "date", label: "Fecha", type: "date" },
        { key: "kind", label: "Tipo" },
        { key: "document", label: "Documento" },
        { key: "charge", label: partyKind === "CUSTOMER" ? "Cargo (factura)" : "Cargo (compra)", type: "money" },
        { key: "payment", label: partyKind === "CUSTOMER" ? "Abono (recibo)" : "Abono (egreso)", type: "money" },
      ],
      rows: rows.map(row => ({
        party: row.party,
        date: iso(row.date),
        kind: row.kind,
        document: row.document,
        charge: money(row.charge),
        payment: money(row.payment),
      })),
      notes: ["Documentos a crédito y pagos activos del período (los de contado no generan saldo)."],
    };
  },
};

const receiptMovement: CatalogReport = {
  id: "movimiento-recibos",
  title: "Movimiento de recibos de caja/pago",
  params: ["partyKind", "period"],
  roles: LEDGER,
  async run(tx, { partyKind, from, to }) {
    const select = { number: true, date: true, method: true, reference: true, total: true, status: true } as const;
    const items =
      partyKind === "CUSTOMER"
        ? (
            await tx.cashReceipt.findMany({
              where: { date: { gte: from, lte: to } },
              select: { ...select, customer: { select: { legalName: true } } },
              orderBy: { number: "asc" },
            })
          ).map(item => ({ ...item, party: item.customer.legalName, label: `RC-${item.number}` }))
        : (
            await tx.supplierPayment.findMany({
              where: { date: { gte: from, lte: to } },
              select: { ...select, supplier: { select: { legalName: true } } },
              orderBy: { number: "asc" },
            })
          ).map(item => ({ ...item, party: item.supplier.legalName, label: `CE-${item.number}` }));
    const rows: Row[] = items.map(item => ({
      date: iso(item.date),
      document: item.label,
      party: item.party,
      method: methodLabel(item.method),
      reference: item.reference ?? "—",
      status: item.status === "VOID" ? "Anulado" : "Activo",
      total: money(item.status === "VOID" ? 0 : item.total),
    }));
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "document", label: partyKind === "CUSTOMER" ? "Recibo de caja" : "Comprobante de egreso" },
        { key: "party", label: partyWord(partyKind) },
        { key: "method", label: "Forma de pago" },
        { key: "reference", label: "Referencia" },
        { key: "status", label: "Estado" },
        { key: "total", label: "Valor", type: "money" },
      ],
      rows,
      notes: ["Los anulados aparecen con valor cero."],
    };
  },
};

const roleLabels = (party: { isCustomer: boolean; isSupplier: boolean; isPayer: boolean }) =>
  [party.isCustomer && "Cliente", party.isSupplier && "Proveedor", party.isPayer && "Otro"]
    .filter(Boolean)
    .join(", ") || "—";
const searchWhere = (search?: string): Prisma.PartyWhereInput =>
  search
    ? {
        OR: [
          { legalName: { contains: search, mode: "insensitive" } },
          { tradeName: { contains: search, mode: "insensitive" } },
          { identificationNumber: { contains: search } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

const partySearch: CatalogReport = {
  id: "terceros",
  title: "Búsqueda de cliente, proveedor u otro",
  params: ["search"],
  roles: VIEW,
  async run(tx, { search }) {
    const parties = await tx.party.findMany({ where: searchWhere(search), orderBy: { legalName: "asc" } });
    return {
      columns: [
        { key: "type", label: "Tipo de identificación" },
        { key: "nit", label: "Identificación" },
        { key: "name", label: "Nombre o razón social" },
        { key: "tradeName", label: "Nombre comercial" },
        { key: "roles", label: "Es" },
        { key: "email", label: "Correo" },
        { key: "phone", label: "Teléfono" },
        { key: "address", label: "Dirección" },
        { key: "municipality", label: "Municipio (DANE)" },
        { key: "status", label: "Estado" },
      ],
      rows: parties.map(party => ({
        type: party.identificationType,
        nit: party.verificationDigit
          ? `${party.identificationNumber}-${party.verificationDigit}`
          : party.identificationNumber,
        name: party.legalName,
        tradeName: party.tradeName ?? "—",
        roles: roleLabels(party),
        email: party.email ?? "—",
        phone: party.phone ?? "—",
        address: party.address ?? "—",
        municipality: party.municipalityCode ?? "—",
        status: party.active ? "Activo" : "Inactivo",
      })),
    };
  },
};

const contactSearch: CatalogReport = {
  id: "contactos-terceros",
  title: "Búsqueda avanzada contacto de cliente, proveedor u otro",
  params: ["search"],
  roles: VIEW,
  async run(tx, { search }) {
    const contacts = await tx.partyContact.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { party: searchWhere(search) },
            ],
          }
        : {},
      select: {
        name: true,
        email: true,
        phone: true,
        position: true,
        isPrimary: true,
        party: {
          select: { legalName: true, identificationNumber: true, isCustomer: true, isSupplier: true, isPayer: true },
        },
      },
      orderBy: [{ party: { legalName: "asc" } }, { name: "asc" }],
    });
    return {
      columns: [
        { key: "party", label: "Tercero" },
        { key: "nit", label: "Identificación" },
        { key: "roles", label: "Es" },
        { key: "name", label: "Contacto" },
        { key: "position", label: "Cargo" },
        { key: "email", label: "Correo" },
        { key: "phone", label: "Teléfono" },
        { key: "primary", label: "Principal" },
      ],
      rows: contacts.map(contact => ({
        party: contact.party.legalName,
        nit: contact.party.identificationNumber,
        roles: roleLabels(contact.party),
        name: contact.name,
        position: contact.position ?? "—",
        email: contact.email ?? "—",
        phone: contact.phone ?? "—",
        primary: contact.isPrimary ? "Sí" : "No",
      })),
      notes: ["Busca por nombre, correo o teléfono del contacto o por los datos del tercero."],
    };
  },
};

// ─── Compras y gastos ────────────────────────────────────────────────────────

async function purchaseLines(tx: Tx, from: Date, to: Date) {
  return tx.purchaseLine.findMany({
    where: { purchaseDocument: { status: "ACTIVE", issueDate: { gte: from, lte: to } } },
    select: {
      quantity: true,
      unitPrice: true,
      discountRate: true,
      lineTotal: true,
      taxRate: true,
      productId: true,
      description: true,
      product: { select: { sku: true, name: true } },
      purchaseDocument: {
        select: { supplierId: true, supplier: { select: { legalName: true, identificationNumber: true } } },
      },
    },
  });
}
type PurchaseLine = Awaited<ReturnType<typeof purchaseLines>>[number];
type Bucket = { quantity: Prisma.Decimal; base: Prisma.Decimal; tax: Prisma.Decimal };
const addPurchase = (acc: Bucket, line: PurchaseLine) => {
  const { base, tax } = lineAmounts(line);
  acc.quantity = acc.quantity.plus(line.quantity);
  acc.base = acc.base.plus(base);
  acc.tax = acc.tax.plus(tax);
};
const purchaseProduct = (line: PurchaseLine) => ({
  code: line.product?.sku ?? "—",
  name: line.product?.name ?? "Gastos e ítems sin producto",
});
const bucketColumns = [
  { key: "quantity", label: "Cantidad", type: "number" as const },
  { key: "base", label: "Valor antes de IVA", type: "money" as const },
  { key: "tax", label: "IVA", type: "money" as const },
  { key: "total", label: "Total", type: "money" as const },
];
const bucketCells = (row: Bucket) => ({
  quantity: qty(row.quantity),
  base: money(row.base),
  tax: money(row.tax),
  total: money(row.base.plus(row.tax)),
});

const purchasesBySupplier: CatalogReport = {
  id: "compras-por-proveedor",
  title: "Compras por proveedor",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const documents = await tx.purchaseDocument.findMany({
      where: { status: "ACTIVE", issueDate: { gte: from, lte: to } },
      select: {
        supplierId: true,
        total: true,
        taxTotal: true,
        supplier: { select: { legalName: true, identificationNumber: true } },
      },
    });
    const groups = accumulate(
      documents,
      document => document.supplierId,
      document => ({ ...document.supplier, count: 0, total: ZERO, tax: ZERO }),
      (acc, document) => {
        acc.count += 1;
        acc.total = acc.total.plus(document.total);
        acc.tax = acc.tax.plus(document.taxTotal);
      }
    );
    return {
      columns: [
        { key: "name", label: "Proveedor" },
        { key: "nit", label: "Identificación" },
        { key: "count", label: "Documentos", type: "number" },
        { key: "base", label: "Valor antes de IVA", type: "money" },
        { key: "tax", label: "IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => b.total.comparedTo(a.total))
        .map(row => ({
          name: row.legalName,
          nit: row.identificationNumber,
          count: row.count,
          base: money(row.total.minus(row.tax)),
          tax: money(row.tax),
          total: money(row.total),
        })),
      notes: ["Compras y gastos vigentes del período (de contado y a crédito)."],
    };
  },
};

const purchasesByProduct: CatalogReport = {
  id: "compras-por-producto",
  title: "Compras por producto",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const lines = await purchaseLines(tx, from, to);
    const groups = accumulate(
      lines,
      line => line.productId ?? "free",
      line => ({ ...purchaseProduct(line), quantity: ZERO, base: ZERO, tax: ZERO }),
      addPurchase
    );
    return {
      columns: [{ key: "code", label: "Código" }, { key: "name", label: "Producto" }, ...bucketColumns],
      rows: [...groups.values()]
        .sort((a, b) => b.base.comparedTo(a.base))
        .map(row => ({ code: row.code, name: row.name, ...bucketCells(row) })),
    };
  },
};

const purchasesByProductSupplier: CatalogReport = {
  id: "compras-producto-proveedor",
  title: "Compras por producto por proveedor",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const lines = await purchaseLines(tx, from, to);
    const groups = accumulate(
      lines,
      line => `${line.productId ?? "free"}|${line.purchaseDocument.supplierId}`,
      line => ({
        ...purchaseProduct(line),
        supplier: line.purchaseDocument.supplier.legalName,
        quantity: ZERO,
        base: ZERO,
        tax: ZERO,
      }),
      addPurchase
    );
    return {
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Producto" },
        { key: "supplier", label: "Proveedor" },
        ...bucketColumns,
      ],
      rows: [...groups.values()]
        .sort((a, b) => a.name.localeCompare(b.name, "es") || b.base.comparedTo(a.base))
        .map(row => ({ code: row.code, name: row.name, supplier: row.supplier, ...bucketCells(row) })),
    };
  },
};

async function purchaseBook(tx: Tx, from: Date, to: Date) {
  return tx.purchaseDocument.findMany({
    where: { status: "ACTIVE", issueDate: { gte: from, lte: to } },
    select: {
      number: true,
      type: true,
      supplierInvoiceNumber: true,
      issueDate: true,
      paymentTerm: true,
      total: true,
      taxTotal: true,
      supplier: { select: { legalName: true, identificationNumber: true } },
      lines: { select: { quantity: true, unitPrice: true, discountRate: true, lineTotal: true, taxRate: true } },
      paymentApplications: { where: { payment: { status: "ACTIVE" } }, select: { amount: true } },
    },
    orderBy: [{ issueDate: "asc" }, { number: "asc" }],
  });
}

const purchaseMovement: CatalogReport = {
  id: "movimiento-compras",
  title: "Movimiento facturas de compra",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const documents = await purchaseBook(tx, from, to);
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "document", label: "Documento" },
        { key: "type", label: "Tipo" },
        { key: "supplier", label: "Proveedor" },
        { key: "supplierInvoice", label: "Factura del proveedor" },
        { key: "term", label: "Forma de pago" },
        { key: "base", label: "Base", type: "money" },
        { key: "tax", label: "IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
        { key: "paid", label: "Pagado", type: "money" },
        { key: "balance", label: "Saldo", type: "money" },
      ],
      rows: documents.map(document => {
        const paid =
          document.paymentTerm === "CASH"
            ? document.total
            : document.paymentApplications.reduce((sum, item) => sum.plus(item.amount), ZERO);
        return {
          date: iso(document.issueDate),
          document: `CG-${document.number}`,
          type: document.type === "PURCHASE" ? "Compra" : "Gasto",
          supplier: document.supplier.legalName,
          supplierInvoice: document.supplierInvoiceNumber,
          term: document.paymentTerm === "CASH" ? "Contado" : "Crédito",
          base: money(document.total.minus(document.taxTotal)),
          tax: money(document.taxTotal),
          total: money(document.total),
          paid: money(paid),
          balance: money(document.total.minus(paid)),
        };
      }),
    };
  },
};

const purchaseLedgerBook: CatalogReport = {
  id: "libro-compras",
  title: "Libro oficial de compras",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const documents = await purchaseBook(tx, from, to);
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "document", label: "Documento" },
        { key: "supplier", label: "Proveedor" },
        { key: "nit", label: "NIT / Identificación" },
        { key: "supplierInvoice", label: "Factura del proveedor" },
        { key: "taxed", label: "Base gravada", type: "money" },
        { key: "exempt", label: "Exenta / excluida", type: "money" },
        { key: "tax", label: "IVA", type: "money" },
        { key: "total", label: "Total", type: "money" },
      ],
      rows: documents.map(document => {
        const bases = document.lines.reduce(
          (acc, line) => {
            const { base } = lineAmounts(line);
            if (line.taxRate.isZero()) acc.exempt = acc.exempt.plus(base);
            else acc.taxed = acc.taxed.plus(base);
            return acc;
          },
          { taxed: ZERO, exempt: ZERO }
        );
        return {
          date: iso(document.issueDate),
          document: `CG-${document.number}`,
          supplier: document.supplier.legalName,
          nit: document.supplier.identificationNumber,
          supplierInvoice: document.supplierInvoiceNumber,
          taxed: money(bases.taxed),
          exempt: money(bases.exempt),
          tax: money(document.taxTotal),
          total: money(document.total),
        };
      }),
    };
  },
};

export const partyReports: CatalogReport[] = [
  generalBalance,
  detailedBalance,
  balanceMovement,
  receiptMovement,
  agingAtDate,
  partySearch,
  contactSearch,
];
export const purchaseReports: CatalogReport[] = [
  purchasesBySupplier,
  purchasesByProduct,
  purchasesByProductSupplier,
  purchaseMovement,
  purchaseLedgerBook,
];
