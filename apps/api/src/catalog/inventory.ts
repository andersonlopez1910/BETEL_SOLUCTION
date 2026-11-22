/**
 * Catálogo de reportes › Productos y servicios (saldos, kárdex, movimiento, listado, rentabilidad) y Nómina
 * (acumulados, seguridad social, provisiones, prima de servicios).
 *
 * Existencias: mismas fuentes que products.ts/costing.ts: compras (tipo compra) vigentes, documentos de inventario
 * vigentes (saldo inicial y ajustes) y facturas emitidas vigentes; solo productos de tipo PRODUCT.
 * Nómina: liquidaciones aprobadas o pagadas, por fecha final del período; valores de PayrollItem.calculation.
 */
import { Prisma } from "@betel/db";
import { inventoryNumber } from "../inventory.js";
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
  percent,
  qty,
  type Row,
  type Tx,
  VIEW,
  yearRange,
  ZERO,
} from "./common.js";

type StockMove = {
  productId: string;
  date: Date;
  document: string;
  concept: string;
  inflow: Prisma.Decimal;
  outflow: Prisma.Decimal;
  order: number;
};

async function stockMoves(tx: Tx, until: Date, productId?: string): Promise<StockMove[]> {
  const product = productId ? { productId } : { productId: { not: null } };
  const [purchases, inventory, sales] = await Promise.all([
    tx.purchaseLine.findMany({
      where: {
        ...product,
        product: { kind: "PRODUCT" },
        purchaseDocument: { status: "ACTIVE", type: "PURCHASE", issueDate: { lte: until } },
      },
      select: {
        productId: true,
        quantity: true,
        purchaseDocument: { select: { number: true, issueDate: true, supplier: { select: { legalName: true } } } },
      },
    }),
    tx.inventoryLine.findMany({
      where: {
        ...(productId && { productId }),
        product: { kind: "PRODUCT" },
        document: { status: "ACTIVE", date: { lte: until } },
      },
      select: {
        productId: true,
        direction: true,
        quantity: true,
        document: { select: { type: true, number: true, date: true } },
      },
    }),
    tx.invoiceLine.findMany({
      where: {
        ...product,
        product: { kind: "PRODUCT" },
        invoice: { status: { in: [...BILLED] }, issueDate: { lte: until } },
      },
      select: {
        productId: true,
        quantity: true,
        invoice: { select: { prefix: true, number: true, issueDate: true, customer: { select: { legalName: true } } } },
      },
    }),
  ]);
  return [
    ...inventory.map(line => ({
      productId: line.productId,
      date: line.document.date,
      document: inventoryNumber(line.document.type, line.document.number),
      concept:
        line.document.type === "INITIAL"
          ? "Saldo inicial"
          : line.direction === "IN"
            ? "Ajuste de entrada"
            : "Ajuste de salida",
      inflow: line.direction === "IN" ? line.quantity : ZERO,
      outflow: line.direction === "OUT" ? line.quantity : ZERO,
      order: 0,
    })),
    ...purchases.map(line => ({
      productId: line.productId!,
      date: line.purchaseDocument.issueDate,
      document: `CG-${line.purchaseDocument.number}`,
      concept: `Compra · ${line.purchaseDocument.supplier.legalName}`,
      inflow: line.quantity,
      outflow: ZERO,
      order: 1,
    })),
    ...sales.map(line => ({
      productId: line.productId!,
      date: line.invoice.issueDate,
      document: invoiceLabel(line.invoice),
      concept: `Venta · ${line.invoice.customer.legalName}`,
      inflow: ZERO,
      outflow: line.quantity,
      order: 2,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);
}

/** Costo promedio del último costeo mensual ejecutado hasta el mes de la fecha (null si no hay). */
async function lastAverageCost(tx: Tx, date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const lines = await tx.costingLine.findMany({
    where: { run: { OR: [{ year: { lt: year } }, { year, month: { lte: month } }] } },
    select: { productId: true, averageCost: true, run: { select: { year: true, month: true } } },
    orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
  });
  const result = new Map<string, Prisma.Decimal>();
  for (const line of lines) if (!result.has(line.productId)) result.set(line.productId, line.averageCost);
  return result;
}

const inventoryBalances: CatalogReport = {
  id: "saldos-inventario",
  title: "Saldos de inventario",
  params: ["date"],
  roles: VIEW,
  async run(tx, { date }) {
    const [products, moves, costs] = await Promise.all([
      tx.product.findMany({
        where: { kind: "PRODUCT" },
        select: { id: true, sku: true, name: true, unit: true },
        orderBy: { name: "asc" },
      }),
      stockMoves(tx, date),
      lastAverageCost(tx, date),
    ]);
    const totals = accumulate(
      moves,
      move => move.productId,
      () => ({ inflow: ZERO, outflow: ZERO }),
      (acc, move) => {
        acc.inflow = acc.inflow.plus(move.inflow);
        acc.outflow = acc.outflow.plus(move.outflow);
      }
    );
    return {
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Producto" },
        { key: "unit", label: "Unidad" },
        { key: "inflow", label: "Entradas", type: "number" },
        { key: "outflow", label: "Salidas", type: "number" },
        { key: "stock", label: "Existencias", type: "number" },
        { key: "cost", label: "Costo promedio", type: "money", sum: false },
        { key: "value", label: "Valor del inventario", type: "money" },
      ],
      rows: products
        .filter(product => totals.has(product.id))
        .map(product => {
          const { inflow, outflow } = totals.get(product.id)!;
          const stock = inflow.minus(outflow);
          const cost = costs.get(product.id);
          return {
            code: product.sku ?? "—",
            name: product.name,
            unit: product.unit,
            inflow: qty(inflow),
            outflow: qty(outflow),
            stock: qty(stock),
            cost: cost ? money(cost) : null,
            value: cost ? money(stock.times(cost)) : null,
          };
        }),
      notes: [
        "Costo promedio del último costeo mensual ejecutado hasta el mes de corte; sin costeo el valor queda en blanco (Productos › Costeo mensual).",
      ],
    };
  },
};

const kardex: CatalogReport = {
  id: "kardex",
  title: "Movimiento de productos / Kárdex",
  params: ["product", "period"],
  roles: VIEW,
  async run(tx, { product, from, to }) {
    const columns = [
      { key: "date", label: "Fecha", type: "date" as const },
      { key: "document", label: "Documento" },
      { key: "concept", label: "Concepto" },
      { key: "inflow", label: "Entrada", type: "number" as const },
      { key: "outflow", label: "Salida", type: "number" as const },
      { key: "balance", label: "Saldo", type: "number" as const, sum: false },
    ];
    if (!product) return { columns, rows: [], notes: ["Elige un producto para ver su kárdex."] };
    const found = await tx.product.findFirst({ where: { id: product }, select: { name: true, kind: true } });
    if (!found) return { columns, rows: [], notes: ["El producto no existe."] };
    if (found.kind !== "PRODUCT") return { columns, rows: [], notes: ["Los servicios no manejan inventario."] };
    const moves = await stockMoves(tx, to, product);
    let balance = moves
      .filter(move => move.date < from)
      .reduce((sum, move) => sum.plus(move.inflow).minus(move.outflow), ZERO);
    const rows: Row[] = [
      { date: iso(from), document: "—", concept: "Saldo anterior", inflow: null, outflow: null, balance: qty(balance) },
    ];
    for (const move of moves.filter(move => move.date >= from)) {
      balance = balance.plus(move.inflow).minus(move.outflow);
      rows.push({
        date: iso(move.date),
        document: move.document,
        concept: move.concept,
        inflow: move.inflow.isZero() ? null : qty(move.inflow),
        outflow: move.outflow.isZero() ? null : qty(move.outflow),
        balance: qty(balance),
      });
    }
    return { columns, rows, notes: [`Kárdex en unidades de ${found.name}.`] };
  },
};

const productMovement: CatalogReport = {
  id: "movimiento-productos",
  title: "Movimiento de productos",
  params: ["period"],
  roles: VIEW,
  async run(tx, { from, to }) {
    const [products, moves] = await Promise.all([
      tx.product.findMany({
        where: { kind: "PRODUCT" },
        select: { id: true, sku: true, name: true },
        orderBy: { name: "asc" },
      }),
      stockMoves(tx, to),
    ]);
    const totals = accumulate(
      moves,
      move => move.productId,
      () => ({ opening: ZERO, inflow: ZERO, outflow: ZERO }),
      (acc, move) => {
        if (move.date < from) acc.opening = acc.opening.plus(move.inflow).minus(move.outflow);
        else {
          acc.inflow = acc.inflow.plus(move.inflow);
          acc.outflow = acc.outflow.plus(move.outflow);
        }
      }
    );
    return {
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Producto" },
        { key: "opening", label: "Saldo inicial", type: "number" },
        { key: "inflow", label: "Entradas", type: "number" },
        { key: "outflow", label: "Salidas", type: "number" },
        { key: "closing", label: "Saldo final", type: "number" },
      ],
      rows: products
        .filter(product => totals.has(product.id))
        .map(product => {
          const row = totals.get(product.id)!;
          return {
            code: product.sku ?? "—",
            name: product.name,
            opening: qty(row.opening),
            inflow: qty(row.inflow),
            outflow: qty(row.outflow),
            closing: qty(row.opening.plus(row.inflow).minus(row.outflow)),
          };
        }),
      notes: ["Unidades: entradas por compras, saldo inicial y ajustes; salidas por ventas y ajustes."],
    };
  },
};

const productList: CatalogReport = {
  id: "listado-productos",
  title: "Listado de productos / servicios",
  params: ["search"],
  roles: VIEW,
  async run(tx, { search, date }) {
    const products = await tx.product.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
      orderBy: { name: "asc" },
    });
    const moves = await stockMoves(tx, date);
    const stock = accumulate(
      moves,
      move => move.productId,
      () => ({ value: ZERO }),
      (acc, move) => {
        acc.value = acc.value.plus(move.inflow).minus(move.outflow);
      }
    );
    return {
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Nombre" },
        { key: "kind", label: "Tipo" },
        { key: "unit", label: "Unidad" },
        { key: "price", label: "Precio de venta", type: "money", sum: false },
        { key: "tax", label: "IVA %", type: "percent" },
        { key: "stock", label: "Existencias", type: "number", sum: false },
        { key: "status", label: "Estado" },
      ],
      rows: products.map(product => ({
        code: product.sku ?? "—",
        name: product.name,
        kind: product.kind === "PRODUCT" ? "Producto" : "Servicio",
        unit: product.unit,
        price: money(product.unitPrice),
        tax: product.taxRate.toFixed(0),
        stock: product.kind === "PRODUCT" ? qty(stock.get(product.id)?.value ?? ZERO) : null,
        status: product.active ? "Activo" : "Inactivo",
      })),
    };
  },
};

const profitability: CatalogReport = {
  id: "rentabilidad-producto",
  title: "Rentabilidad por producto",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    // Meses completos: el costo de ventas sale del costeo mensual.
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
    const months: { year: number; month: number }[] = [];
    for (let d = new Date(start); d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
      months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
    const [lines, costing] = await Promise.all([
      tx.invoiceLine.findMany({
        where: {
          productId: { not: null },
          invoice: { status: { in: [...BILLED] }, issueDate: { gte: start, lte: end } },
        },
        select: {
          productId: true,
          quantity: true,
          unitPrice: true,
          discountRate: true,
          lineTotal: true,
          product: { select: { sku: true, name: true, kind: true } },
          invoice: { select: { issueDate: true } },
        },
      }),
      tx.costingRun.findMany({
        where: { OR: months },
        select: { year: true, month: true, lines: { select: { productId: true, salesCost: true } } },
      }),
    ]);
    const costed = new Set(costing.map(run => `${run.year}-${run.month}`));
    const cost = new Map<string, Prisma.Decimal>();
    for (const run of costing)
      for (const line of run.lines) cost.set(line.productId, (cost.get(line.productId) ?? ZERO).plus(line.salesCost));
    const groups = accumulate(
      lines,
      line => line.productId!,
      line => ({
        id: line.productId!,
        code: line.product?.sku ?? "—",
        name: line.product?.name ?? "",
        kind: line.product?.kind,
        quantity: ZERO,
        base: ZERO,
      }),
      (acc, line) => {
        acc.quantity = acc.quantity.plus(line.quantity);
        acc.base = acc.base.plus(lineAmounts(line).base);
      }
    );
    const missing = months.filter(m => !costed.has(`${m.year}-${m.month}`));
    return {
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Producto" },
        { key: "quantity", label: "Cantidad vendida", type: "number" },
        { key: "sales", label: "Ventas antes de IVA", type: "money" },
        { key: "cost", label: "Costo de ventas", type: "money" },
        { key: "profit", label: "Utilidad bruta", type: "money" },
        { key: "margin", label: "Margen %", type: "percent" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => b.base.comparedTo(a.base))
        .map(row => {
          const rowCost = row.kind === "PRODUCT" ? (cost.get(row.id) ?? ZERO) : ZERO;
          const profit = row.base.minus(rowCost);
          return {
            code: row.code,
            name: row.name,
            quantity: qty(row.quantity),
            sales: money(row.base),
            cost: money(rowCost),
            profit: money(profit),
            margin: percent(profit, row.base),
          };
        }),
      notes: [
        `Meses completos del ${iso(start)} al ${iso(end)}. El costo sale del costeo mensual; los servicios no tienen costo.`,
        ...(missing.length
          ? [
              `Sin costeo mensual en ${missing.map(m => `${m.month}/${m.year}`).join(", ")}: el costo de esos meses aparece en cero.`,
            ]
          : []),
      ],
    };
  },
};

// ─── Nómina ──────────────────────────────────────────────────────────────────

type Calculation = Record<string, number>;

async function payrollItems(tx: Tx, periodEnd: Prisma.DateTimeFilter) {
  const items = await tx.payrollItem.findMany({
    where: { run: { status: { in: ["APPROVED", "PAID"] }, periodEnd } },
    select: {
      days: true,
      earnings: true,
      deductions: true,
      netPay: true,
      employerCost: true,
      calculation: true,
      employeeId: true,
      run: { select: { periodEnd: true } },
      employee: { select: { firstName: true, lastName: true, identificationNumber: true } },
    },
  });
  return items.map(item => ({ ...item, calc: item.calculation as Calculation }));
}
type Item = Awaited<ReturnType<typeof payrollItems>>[number];

/** Suma por empleado de los campos indicados del cálculo. */
function byEmployee(
  items: Item[],
  fields: string[],
  extra?: (acc: Record<string, Prisma.Decimal>, item: Item) => void
) {
  return accumulate(
    items,
    item => item.employeeId,
    item => ({
      employee: `${item.employee.firstName} ${item.employee.lastName}`,
      nit: item.employee.identificationNumber,
      values: Object.fromEntries(fields.map(field => [field, ZERO])) as Record<string, Prisma.Decimal>,
    }),
    (acc, item) => {
      for (const field of fields) acc.values[field] = acc.values[field]!.plus(D(item.calc[field] ?? 0));
      extra?.(acc.values, item);
    }
  );
}
const employeeRows = (groups: ReturnType<typeof byEmployee>, fields: string[]) =>
  [...groups.values()]
    .sort((a, b) => a.employee.localeCompare(b.employee, "es"))
    .map(row => ({
      employee: row.employee,
      nit: row.nit,
      ...Object.fromEntries(fields.map(field => [field, money(row.values[field]!)])),
    }));
const employeeColumns = [
  { key: "employee", label: "Empleado" },
  { key: "nit", label: "Identificación" },
];
const payrollNote = "Liquidaciones de nómina aprobadas o pagadas, por fecha final del período liquidado.";

const accumulated: CatalogReport = {
  id: "nomina-acumulados",
  title: "Acumulados",
  params: ["year"],
  roles: LEDGER,
  async run(tx, { year }) {
    const items = await payrollItems(tx, yearRange(year));
    const fields = ["days", "basicPay", "overtimePay", "transport", "earnings", "deductions", "netPay", "employerCost"];
    const groups = byEmployee(items, ["basicPay", "overtimePay", "transport"], (values, item) => {
      values.days = (values.days ?? ZERO).plus(item.days);
      values.earnings = (values.earnings ?? ZERO).plus(item.earnings);
      values.deductions = (values.deductions ?? ZERO).plus(item.deductions);
      values.netPay = (values.netPay ?? ZERO).plus(item.netPay);
      values.employerCost = (values.employerCost ?? ZERO).plus(item.employerCost);
    });
    return {
      columns: [
        ...employeeColumns,
        { key: "days", label: "Días", type: "number" },
        { key: "basicPay", label: "Salario básico", type: "money" },
        { key: "overtimePay", label: "Extras y recargos", type: "money" },
        { key: "transport", label: "Auxilio de transporte", type: "money" },
        { key: "earnings", label: "Total devengado", type: "money" },
        { key: "deductions", label: "Deducciones", type: "money" },
        { key: "netPay", label: "Neto pagado", type: "money" },
        { key: "employerCost", label: "Aportes y provisiones", type: "money" },
      ],
      rows: employeeRows(groups, fields).map(row => ({ ...row, days: D((row as Row).days as string).toFixed(0) })),
      notes: [payrollNote],
    };
  },
};

const socialSecurity: CatalogReport = {
  id: "nomina-seguridad-social",
  title: "Seguridad social y parafiscales",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const items = await payrollItems(tx, { gte: from, lte: to });
    const fields = [
      "ibc",
      "healthEmployee",
      "healthEmployer",
      "pensionEmployee",
      "pensionEmployer",
      "solidarity",
      "arl",
      "compensation",
      "icbf",
      "sena",
    ];
    const groups = byEmployee(items, fields);
    return {
      columns: [
        ...employeeColumns,
        { key: "ibc", label: "IBC", type: "money" },
        { key: "healthEmployee", label: "Salud empleado", type: "money" },
        { key: "healthEmployer", label: "Salud empresa", type: "money" },
        { key: "pensionEmployee", label: "Pensión empleado", type: "money" },
        { key: "pensionEmployer", label: "Pensión empresa", type: "money" },
        { key: "solidarity", label: "Fondo de solidaridad", type: "money" },
        { key: "arl", label: "ARL", type: "money" },
        { key: "compensation", label: "Caja de compensación", type: "money" },
        { key: "icbf", label: "ICBF", type: "money" },
        { key: "sena", label: "SENA", type: "money" },
        { key: "total", label: "Total aportes", type: "money" },
      ],
      rows: employeeRows(groups, fields).map(row => ({
        ...row,
        total: money(
          fields.slice(1).reduce((sum, field) => sum.plus(D(row[field as keyof typeof row] as string)), ZERO)
        ),
      })),
      notes: [payrollNote, "Base para la planilla PILA; Betel no la transmite al operador."],
    };
  },
};

const provisions: CatalogReport = {
  id: "nomina-provisiones",
  title: "Provisiones",
  params: ["period"],
  roles: LEDGER,
  async run(tx, { from, to }) {
    const items = await payrollItems(tx, { gte: from, lte: to });
    const fields = ["severance", "severanceInterest", "serviceBonus", "vacation"];
    const groups = byEmployee(items, fields);
    return {
      columns: [
        ...employeeColumns,
        { key: "severance", label: "Cesantías", type: "money" },
        { key: "severanceInterest", label: "Intereses de cesantías", type: "money" },
        { key: "serviceBonus", label: "Prima de servicios", type: "money" },
        { key: "vacation", label: "Vacaciones", type: "money" },
        { key: "total", label: "Total provisiones", type: "money" },
      ],
      rows: employeeRows(groups, fields).map(row => ({
        ...row,
        total: money(fields.reduce((sum, field) => sum.plus(D(row[field as keyof typeof row] as string)), ZERO)),
      })),
      notes: [
        payrollNote,
        "Valores provisionados (cuentas 2510, 2515, 2520 y 2525); Betel aún no registra el pago de prestaciones.",
      ],
    };
  },
};

const serviceBonus: CatalogReport = {
  id: "nomina-prima",
  title: "Prima de servicios",
  params: ["year"],
  roles: LEDGER,
  async run(tx, { year }) {
    const items = await payrollItems(tx, yearRange(year));
    const groups = byEmployee(items, [], (values, item) => {
      const key = item.run.periodEnd.getUTCMonth() < 6 ? "first" : "second";
      values[key] = (values[key] ?? ZERO).plus(D(item.calc.serviceBonus ?? 0));
    });
    return {
      columns: [
        ...employeeColumns,
        { key: "first", label: "Primer semestre (jun. 30)", type: "money" },
        { key: "second", label: "Segundo semestre (dic. 20)", type: "money" },
        { key: "total", label: "Total del año", type: "money" },
      ],
      rows: [...groups.values()]
        .sort((a, b) => a.employee.localeCompare(b.employee, "es"))
        .map(row => {
          const first = row.values.first ?? ZERO;
          const second = row.values.second ?? ZERO;
          return {
            employee: row.employee,
            nit: row.nit,
            first: money(first),
            second: money(second),
            total: money(first.plus(second)),
          };
        }),
      notes: [
        payrollNote,
        "Prima provisionada en cada liquidación (salario + auxilio de transporte / 12). El pago se registra fuera de Betel por ahora.",
      ],
    };
  },
};

export const productReports: CatalogReport[] = [profitability, inventoryBalances, kardex, productMovement, productList];
export const payrollReports: CatalogReport[] = [serviceBonus, provisions, accumulated, socialSecurity];
