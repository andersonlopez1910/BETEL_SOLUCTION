/**
 * Catálogo de reportes › Contables, Financieros, Tributario / Libros oficiales y Auditoría.
 * Todos usan los comprobantes contabilizados (POSTED) salvo «Comprobantes no contabilizados», que busca documentos
 * sin comprobante. Saldos = débitos − créditos; en patrimonio y pasivo se muestran con signo de su naturaleza.
 */
import { Prisma } from "@betel/db";
import { sourceLabels } from "../ledger.js";
import { accountNature, catalogName } from "../puc.js";
import {
  accumulate,
  BILLED,
  type CatalogReport,
  D,
  invoiceLabel,
  iso,
  LEDGER,
  lineAmounts,
  money,
  type Row,
  type Tx,
  ZERO,
} from "./common.js";

const DAY = 86_400_000;
const posted = (date: Prisma.DateTimeFilter, extra: Prisma.JournalEntryWhereInput = {}) => ({
  journalEntry: { status: "POSTED" as const, date, ...extra },
});

async function accountNames(tx: Tx) {
  const accounts = await tx.account.findMany({ select: { id: true, code: true, name: true } });
  return {
    byId: new Map(accounts.map(account => [account.id, account])),
    name: (code: string) =>
      accounts.find(account => account.code === code)?.name ?? catalogName(code) ?? `Cuenta ${code}`,
  };
}

/** Débitos y créditos por cuenta registrada en un rango de fechas. */
async function sums(tx: Tx, date: Prisma.DateTimeFilter, extra?: Prisma.JournalEntryWhereInput) {
  const rows = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: posted(date, extra),
    _sum: { debit: true, credit: true },
  });
  return rows.map(row => ({ accountId: row.accountId, debit: D(row._sum.debit), credit: D(row._sum.credit) }));
}

const auxiliary: CatalogReport = {
  id: "auxiliar-cuenta",
  title: "Movimiento auxiliar por cuenta contable",
  params: ["account", "period"],
  roles: LEDGER,
  async run(tx, { account, from, to }) {
    const columns = [
      { key: "date", label: "Fecha", type: "date" as const },
      { key: "reference", label: "Comprobante" },
      { key: "source", label: "Origen" },
      { key: "account", label: "Cuenta" },
      { key: "description", label: "Descripción" },
      { key: "debit", label: "Débito", type: "money" as const },
      { key: "credit", label: "Crédito", type: "money" as const },
      { key: "balance", label: "Saldo", type: "money" as const, sum: false },
    ];
    if (!account) return { columns, rows: [], notes: ["Elige una cuenta (clase, grupo, cuenta o subcuenta)."] };
    const accountFilter = { account: { code: { startsWith: account } } };
    const [opening, lines] = await Promise.all([
      tx.journalLine.aggregate({
        where: { ...accountFilter, ...posted({ lt: from }) },
        _sum: { debit: true, credit: true },
      }),
      tx.journalLine.findMany({
        where: { ...accountFilter, ...posted({ gte: from, lte: to }) },
        select: {
          debit: true,
          credit: true,
          memo: true,
          account: { select: { code: true, name: true } },
          journalEntry: { select: { date: true, reference: true, description: true, sourceType: true } },
        },
        orderBy: [{ journalEntry: { date: "asc" } }, { journalEntry: { createdAt: "asc" } }],
      }),
    ]);
    let balance = D(opening._sum.debit).minus(D(opening._sum.credit));
    const rows: Row[] = [
      {
        date: iso(from),
        reference: "—",
        source: "—",
        account: account,
        description: "Saldo anterior",
        debit: null,
        credit: null,
        balance: money(balance),
      },
    ];
    for (const line of lines) {
      balance = balance.plus(line.debit).minus(line.credit);
      rows.push({
        date: iso(line.journalEntry.date),
        reference: line.journalEntry.reference,
        source: sourceLabels[line.journalEntry.sourceType ?? "Manual"] ?? line.journalEntry.sourceType ?? "—",
        account: `${line.account.code} ${line.account.name}`,
        description: line.memo || line.journalEntry.description,
        debit: money(line.debit),
        credit: money(line.credit),
        balance: money(balance),
      });
    }
    return {
      columns,
      rows,
      notes: [`Cuenta ${account} ${catalogName(account) ?? ""} y sus subcuentas. Saldo = débitos − créditos.`.trim()],
    };
  },
};

const sequence: CatalogReport = {
  id: "consecutivo-comprobantes",
  title: "Consecutivo de comprobantes",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const entries = await tx.journalEntry.findMany({
      where: { date: { gte: from, lte: to } },
      select: { reference: true, status: true, sourceType: true },
    });
    const numberOf = (reference: string) => Number(reference.match(/(\d+)$/)?.[1] ?? NaN);
    const prefixOf = (reference: string) => reference.replace(/-?\d+$/, "");
    const groups = accumulate(
      entries,
      entry => `${entry.sourceType ?? "Manual"}|${prefixOf(entry.reference)}`,
      entry => ({
        type: sourceLabels[entry.sourceType ?? "Manual"] ?? entry.sourceType ?? "—",
        prefix: prefixOf(entry.reference),
        references: [] as string[],
        posted: 0,
        reversed: 0,
        draft: 0,
      }),
      (acc, entry) => {
        acc.references.push(entry.reference);
        if (entry.status === "POSTED") acc.posted += 1;
        else if (entry.status === "REVERSED") acc.reversed += 1;
        else acc.draft += 1;
      }
    );
    return {
      columns: [
        { key: "type", label: "Tipo de comprobante" },
        { key: "prefix", label: "Prefijo" },
        { key: "count", label: "Comprobantes", type: "number" },
        { key: "first", label: "Primero" },
        { key: "last", label: "Último" },
        { key: "posted", label: "Contabilizados", type: "number" },
        { key: "reversed", label: "Anulados", type: "number" },
        { key: "gaps", label: "Números faltantes" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => a.type.localeCompare(b.type, "es"))
        .map(row => {
          const sorted = [...row.references].sort((a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b));
          const numbers = sorted.map(numberOf).filter(Number.isFinite);
          const gaps: number[] = [];
          for (let i = 1; i < numbers.length && gaps.length < 20; i++)
            for (let n = numbers[i - 1]! + 1; n < numbers[i]! && gaps.length < 20; n++) gaps.push(n);
          return {
            type: row.type,
            prefix: row.prefix || "—",
            count: row.references.length,
            first: sorted[0] ?? "—",
            last: sorted.at(-1) ?? "—",
            posted: row.posted,
            reversed: row.reversed,
            gaps: gaps.length ? gaps.join(", ") : "Ninguno",
          };
        }),
      notes: ["Los números faltantes se calculan dentro del período (muestra hasta 20 por tipo)."],
    };
  },
};

const notPosted: CatalogReport = {
  id: "comprobantes-no-contabilizados",
  title: "Comprobantes no contabilizados",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const range = { gte: from, lte: to };
    const [entries, invoices, receipts, purchases, payments, payroll, inventory] = await Promise.all([
      tx.journalEntry.findMany({
        where: { status: "POSTED", sourceId: { not: null } },
        select: { sourceType: true, sourceId: true },
      }),
      tx.invoice.findMany({
        where: { status: { in: [...BILLED] }, issueDate: range },
        select: { id: true, prefix: true, number: true, issueDate: true, total: true },
      }),
      tx.cashReceipt.findMany({
        where: { status: "ACTIVE", date: range },
        select: { id: true, number: true, date: true, total: true, onlinePayment: { select: { id: true } } },
      }),
      tx.purchaseDocument.findMany({
        where: { status: "ACTIVE", issueDate: range },
        select: { id: true, number: true, issueDate: true, total: true },
      }),
      tx.supplierPayment.findMany({
        where: { status: "ACTIVE", date: range },
        select: { id: true, number: true, date: true, total: true },
      }),
      tx.payrollRun.findMany({
        where: { status: { in: ["APPROVED", "PAID"] }, periodEnd: range },
        select: { id: true, number: true, periodEnd: true, netPay: true },
      }),
      tx.inventoryDocument.findMany({
        where: { status: "ACTIVE", date: range },
        select: { id: true, type: true, number: true, date: true, total: true },
      }),
    ]);
    const withEntry = new Set(entries.map(entry => `${entry.sourceType}|${entry.sourceId}`));
    const rows: Row[] = [];
    const check = (sourceType: string, id: string, date: Date, document: string, total: Prisma.Decimal) => {
      if (!withEntry.has(`${sourceType}|${id}`))
        rows.push({ date: iso(date), type: sourceLabels[sourceType] ?? sourceType, document, total: money(total) });
    };
    invoices.forEach(item => check("Invoice", item.id, item.issueDate, invoiceLabel(item), item.total));
    // Los recibos de pagos en línea se contabilizan con el pago (origen OnlinePayment).
    receipts.forEach(item =>
      item.onlinePayment
        ? check("OnlinePayment", item.onlinePayment.id, item.date, `RC-${item.number}`, item.total)
        : check("CashReceipt", item.id, item.date, `RC-${item.number}`, item.total)
    );
    purchases.forEach(item => check("PurchaseDocument", item.id, item.issueDate, `CG-${item.number}`, item.total));
    payments.forEach(item => check("SupplierPayment", item.id, item.date, `CE-${item.number}`, item.total));
    payroll.forEach(item => check("PayrollRun", item.id, item.periodEnd, `NOM-${item.number}`, item.netPay));
    inventory.forEach(item =>
      check(
        "InventoryDocument",
        item.id,
        item.date,
        `${item.type === "INITIAL" ? "SI" : "AJ"}-${item.number}`,
        item.total
      )
    );
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "type", label: "Tipo de documento" },
        { key: "document", label: "Documento" },
        { key: "total", label: "Valor", type: "money" },
      ],
      rows: rows.sort((a, b) => String(a.date).localeCompare(String(b.date))),
      notes: [
        "Documentos vigentes del período sin comprobante contable contabilizado. Betel contabiliza automáticamente, así que lo normal es que esté vacío; si aparece alguno, revísalo con soporte.",
      ],
    };
  },
};

/** Saldos por cuenta registrada a una fecha (incluido el cierre de año). */
async function balancesAt(tx: Tx, date: Date) {
  const [{ byId }, rows] = await Promise.all([accountNames(tx), sums(tx, { lte: date })]);
  return rows
    .map(row => ({ ...byId.get(row.accountId)!, balance: row.debit.minus(row.credit) }))
    .filter(row => row.code && !row.balance.isZero())
    .sort((a, b) => a.code.localeCompare(b.code));
}
const natural = (code: string, balance: Prisma.Decimal) =>
  accountNature(code) === "CREDIT" ? balance.negated() : balance;

const inventoriesBook: CatalogReport = {
  id: "libro-inventarios-balance",
  title: "Libro de inventarios y balance",
  params: ["date"],
  roles: LEDGER,
  async run(tx, { date }) {
    const balances = (await balancesAt(tx, date)).filter(row => ["1", "2", "3"].includes(row.code[0]!));
    const openResult = (await balancesAt(tx, date))
      .filter(row => ["4", "5", "6", "7"].includes(row.code[0]!))
      .reduce((sum, row) => sum.minus(row.balance), ZERO);
    const rows: Row[] = [];
    for (const [digit, title] of [
      ["1", "ACTIVO"],
      ["2", "PASIVO"],
      ["3", "PATRIMONIO"],
    ] as const) {
      const accounts = balances.filter(row => row.code.startsWith(digit));
      let total = accounts.reduce((sum, row) => sum.plus(natural(row.code, row.balance)), ZERO);
      if (digit === "3") total = total.plus(openResult);
      rows.push({ code: digit, name: title, balance: money(total), level: "Clase" });
      for (const row of accounts)
        rows.push({ code: row.code, name: row.name, balance: money(natural(row.code, row.balance)), level: "Detalle" });
      if (digit === "3" && !openResult.isZero())
        rows.push({
          code: "—",
          name: "Resultado del ejercicio (años sin cerrar)",
          balance: money(openResult),
          level: "Detalle",
        });
    }
    return {
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Cuenta" },
        { key: "level", label: "Nivel" },
        { key: "balance", label: "Saldo", type: "money", sum: false },
      ],
      rows,
      notes: [
        `Saldos al ${iso(date)} por cuenta auxiliar registrada, con signo de su naturaleza. El inventario detallado por producto está en «Saldos de inventario».`,
      ],
    };
  },
};

/** Saldo anterior, débitos, créditos y saldo final por cuenta de 4 dígitos (o la clase indicada). */
async function ledgerByAccount(tx: Tx, from: Date, to: Date) {
  const [{ byId, name }, before, during] = await Promise.all([
    accountNames(tx),
    sums(tx, { lt: from }),
    sums(tx, { gte: from, lte: to }),
  ]);
  const rows = new Map<string, { opening: Prisma.Decimal; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  const entry = (accountId: string) => {
    const code = byId.get(accountId)!.code.slice(0, 4);
    const row = rows.get(code) ?? { opening: ZERO, debit: ZERO, credit: ZERO };
    rows.set(code, row);
    return row;
  };
  for (const row of before) {
    const target = entry(row.accountId);
    target.opening = target.opening.plus(row.debit).minus(row.credit);
  }
  for (const row of during) {
    const target = entry(row.accountId);
    target.debit = target.debit.plus(row.debit);
    target.credit = target.credit.plus(row.credit);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, row]) => ({ code, name: name(code), ...row, closing: row.opening.plus(row.debit).minus(row.credit) }));
}

const generalLedger: CatalogReport = {
  id: "libro-mayor",
  title: "Libro Mayor y Balance",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const rows = await ledgerByAccount(tx, from, to);
    return {
      columns: [
        { key: "code", label: "Cuenta" },
        { key: "name", label: "Nombre" },
        { key: "opening", label: "Saldo anterior", type: "money" },
        { key: "debit", label: "Débitos", type: "money" },
        { key: "credit", label: "Créditos", type: "money" },
        { key: "closing", label: "Nuevo saldo", type: "money" },
      ],
      rows: rows
        .filter(row => !(row.opening.isZero() && row.debit.isZero() && row.credit.isZero()))
        .map(row => ({
          code: row.code,
          name: row.name,
          opening: money(row.opening),
          debit: money(row.debit),
          credit: money(row.credit),
          closing: money(row.closing),
        })),
      notes: ["Cuentas de mayor (4 dígitos). Saldo = débitos − créditos: los saldos crédito aparecen negativos."],
    };
  },
};

const dailyReport: CatalogReport = {
  id: "comprobante-diario",
  title: "Comprobante informe diario",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const [{ name }, lines] = await Promise.all([
      accountNames(tx),
      tx.journalLine.findMany({
        where: posted({ gte: from, lte: to }),
        select: {
          debit: true,
          credit: true,
          account: { select: { code: true } },
          journalEntry: { select: { date: true } },
        },
      }),
    ]);
    const groups = accumulate(
      lines,
      line => `${iso(line.journalEntry.date)}|${line.account.code.slice(0, 4)}`,
      line => ({ date: iso(line.journalEntry.date), code: line.account.code.slice(0, 4), debit: ZERO, credit: ZERO }),
      (acc, line) => {
        acc.debit = acc.debit.plus(line.debit);
        acc.credit = acc.credit.plus(line.credit);
      }
    );
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "code", label: "Cuenta" },
        { key: "name", label: "Nombre" },
        { key: "debit", label: "Débitos", type: "money" },
        { key: "credit", label: "Créditos", type: "money" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))
        .map(row => ({
          date: row.date,
          code: row.code,
          name: name(row.code),
          debit: money(row.debit),
          credit: money(row.credit),
        })),
      notes: ["Resumen diario de los movimientos por cuenta de mayor. Débitos y créditos de cada día cuadran."],
    };
  },
};

const equityChanges: CatalogReport = {
  id: "cambios-patrimonio",
  title: "Estado de cambios en el patrimonio",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const rows = (await ledgerByAccount(tx, from, to)).filter(row => row.code.startsWith("3"));
    const result = async (date: Prisma.DateTimeFilter, extra?: Prisma.JournalEntryWhereInput) => {
      const { byId } = await accountNames(tx);
      return (await sums(tx, date, extra))
        .filter(row => ["4", "5", "6", "7"].includes(byId.get(row.accountId)!.code[0]!))
        .reduce((sum, row) => sum.plus(row.credit).minus(row.debit), ZERO);
    };
    // Resultado sin cerrar (clases 4 a 7) al inicio y su variación en el período.
    const openingResult = await result({ lt: from });
    const periodResult = await result({ gte: from, lte: to });
    const table: Row[] = rows.map(row => ({
      code: row.code,
      name: row.name,
      opening: money(row.opening.negated()),
      increase: money(row.credit),
      decrease: money(row.debit),
      closing: money(row.closing.negated()),
    }));
    if (!openingResult.isZero() || !periodResult.isZero())
      table.push({
        code: "—",
        name: "Resultado del ejercicio (sin cerrar)",
        opening: money(openingResult),
        increase: money(periodResult.greaterThan(0) ? periodResult : 0),
        decrease: money(periodResult.lessThan(0) ? periodResult.negated() : 0),
        closing: money(openingResult.plus(periodResult)),
      });
    return {
      columns: [
        { key: "code", label: "Cuenta" },
        { key: "name", label: "Concepto" },
        { key: "opening", label: "Saldo inicial", type: "money" },
        { key: "increase", label: "Aumentos", type: "money" },
        { key: "decrease", label: "Disminuciones", type: "money" },
        { key: "closing", label: "Saldo final", type: "money" },
      ],
      rows: table,
      notes: [
        "Cuentas de la clase 3 con signo crédito (positivo = patrimonio). El resultado de los años sin cerrar se calcula con las clases 4 a 7; el cierre de año lo traslada a 3605/3610.",
      ],
    };
  },
};

const detailedTaxes: CatalogReport = {
  id: "impuestos-detallados",
  title: "Impuestos detallados",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const [invoices, purchases] = await Promise.all([
      tx.invoice.findMany({
        where: { status: { in: [...BILLED] }, issueDate: { gte: from, lte: to } },
        select: {
          prefix: true,
          number: true,
          issueDate: true,
          customer: { select: { legalName: true, identificationNumber: true } },
          lines: { select: { quantity: true, unitPrice: true, discountRate: true, lineTotal: true, taxRate: true } },
        },
      }),
      tx.purchaseDocument.findMany({
        where: { status: "ACTIVE", issueDate: { gte: from, lte: to } },
        select: {
          number: true,
          issueDate: true,
          supplier: { select: { legalName: true, identificationNumber: true } },
          lines: { select: { quantity: true, unitPrice: true, discountRate: true, lineTotal: true, taxRate: true } },
        },
      }),
    ]);
    const rows: (Row & { sort: string })[] = [];
    const push = (
      kind: string,
      date: Date,
      document: string,
      party: { legalName: string; identificationNumber: string },
      lines: {
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        discountRate: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
        taxRate: Prisma.Decimal;
      }[]
    ) => {
      const byRate = accumulate(
        lines,
        line => line.taxRate.toFixed(2),
        line => ({ rate: line.taxRate, base: ZERO, tax: ZERO }),
        (acc, line) => {
          const amounts = lineAmounts(line);
          acc.base = acc.base.plus(amounts.base);
          acc.tax = acc.tax.plus(amounts.tax);
        }
      );
      for (const item of byRate.values())
        rows.push({
          sort: `${iso(date)}|${kind}|${document}`,
          kind,
          date: iso(date),
          document,
          party: party.legalName,
          nit: party.identificationNumber,
          rate: item.rate.toFixed(0),
          base: money(item.base),
          generated: kind === "Venta" ? money(item.tax) : money(0),
          deductible: kind === "Compra" ? money(item.tax) : money(0),
        });
    };
    invoices.forEach(invoice =>
      push("Venta", invoice.issueDate, invoiceLabel(invoice), invoice.customer, invoice.lines)
    );
    purchases.forEach(purchase =>
      push("Compra", purchase.issueDate, `CG-${purchase.number}`, purchase.supplier, purchase.lines)
    );
    return {
      columns: [
        { key: "date", label: "Fecha", type: "date" },
        { key: "kind", label: "Operación" },
        { key: "document", label: "Documento" },
        { key: "party", label: "Tercero" },
        { key: "nit", label: "Identificación" },
        { key: "rate", label: "Tarifa IVA %", type: "percent" },
        { key: "base", label: "Base", type: "money" },
        { key: "generated", label: "IVA generado", type: "money" },
        { key: "deductible", label: "IVA descontable", type: "money" },
      ],
      rows: rows.sort((a, b) => a.sort.localeCompare(b.sort)).map(({ sort: _sort, ...row }) => row),
      notes: ["IVA por documento y tarifa. Betel aún no calcula retenciones (renta, IVA, ICA) ni impuesto al consumo."],
    };
  },
};

const entityLabels: Record<string, string> = {
  JournalEntry: "Comprobante contable",
  Invoice: "Factura de venta",
  CashReceipt: "Recibo de caja",
  Quote: "Cotización",
  Delivery: "Remisión",
  PurchaseDocument: "Compra o gasto",
  SupplierPayment: "Comprobante de egreso",
  InventoryDocument: "Documento de inventario",
  PayrollRun: "Nómina",
  JournalTemplate: "Comprobante favorito",
  Account: "Cuenta contable",
  RecurringInvoice: "Factura recurrente",
};
const actionLabels: Record<string, string> = { VOID: "Anulación", DELETE: "Eliminación" };

const deletionAudit: CatalogReport = {
  id: "auditoria-borrado",
  title: "Auditoría de borrado de comprobantes",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const logs = await tx.auditLog.findMany({
      where: { action: { in: ["VOID", "DELETE"] }, createdAt: { gte: from, lt: new Date(to.getTime() + DAY) } },
      select: {
        entity: true,
        entityId: true,
        action: true,
        before: true,
        after: true,
        createdAt: true,
        user: { select: { displayName: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const field = (value: Prisma.JsonValue | null, ...keys: string[]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      for (const key of keys) {
        const found = (value as Record<string, unknown>)[key];
        if (typeof found === "string" || typeof found === "number") return String(found);
      }
      return null;
    };
    return {
      columns: [
        { key: "date", label: "Fecha y hora" },
        { key: "user", label: "Usuario" },
        { key: "action", label: "Acción" },
        { key: "entity", label: "Documento" },
        { key: "reference", label: "Número" },
        { key: "reason", label: "Motivo" },
      ],
      rows: logs.map(log => ({
        date: log.createdAt.toLocaleString("es-CO", { timeZone: "America/Bogota" }),
        user: log.user?.displayName || log.user?.email || "—",
        action: actionLabels[log.action] ?? log.action,
        entity: entityLabels[log.entity] ?? log.entity,
        reference:
          field(log.after, "reference", "number", "name", "voided") ??
          field(log.before, "reference", "number", "name") ??
          log.entityId.slice(0, 8),
        reason: field(log.after, "reason", "voidReason") ?? "—",
      })),
      notes: [
        "Betel no borra documentos contabilizados: los anula con motivo. Aquí aparecen anulaciones y eliminaciones permitidas.",
      ],
    };
  },
};

export const accountingReports: CatalogReport[] = [sequence, notPosted, auxiliary, equityChanges];
export const taxReports: CatalogReport[] = [inventoriesBook, detailedTaxes, generalLedger, dailyReport];
export const auditReports: CatalogReport[] = [deletionAudit];
