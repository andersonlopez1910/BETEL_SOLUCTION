/**
 * Nómina: parámetros por año, empleados, liquidaciones (quincenal o mensual), pago y nómina electrónica.
 *
 * Rutas (solo OWNER, ADMIN y ACCOUNTANT: los salarios son información sensible):
 *   GET  /v1/payroll/settings/:year ............ parámetros del año (propuestos si aún no se han guardado)
 *   PUT  /v1/payroll/settings/:year ............ guardar o confirmar parámetros
 *   GET  /v1/payroll/employees ................. empleados (search, status)
 *   POST /v1/payroll/employees ................. crear · PUT /:id editar · POST /:id/active activar o retirar
 *   GET  /v1/payroll/runs?year= ................ liquidaciones del año
 *   POST /v1/payroll/runs ...................... nueva liquidación en borrador con los empleados del período
 *   GET  /v1/payroll/runs/:id .................. detalle con el cálculo por empleado
 *   PUT  /v1/payroll/runs/:id/items/:itemId .... novedades de un empleado (solo en borrador; recalcula)
 *   POST /v1/payroll/runs/:id/approve .......... aprobar y contabilizar (causación)
 *   POST /v1/payroll/runs/:id/pay .............. pagar (egreso de caja o bancos)
 *   POST /v1/payroll/runs/:id/void ............. anular (borrador o aprobada sin pagar; reversa la causación)
 *   GET  /v1/payroll/electronic?year=&month= ... nómina electrónica del mes por empleado
 *   POST /v1/payroll/electronic/:year/:month/transmit  generar y enviar al proveedor DIAN (pruebas: en cola)
 *
 * CÁLCULO (también en docs/nomina.md; parámetros editables por año, ver PayrollSettings):
 *   - Mes comercial de 30 días. Básico = salario ÷ 30 × días. Valor hora = salario ÷ horas mensuales.
 *   - Horas extra diurnas/nocturnas = horas × valor hora × (1 + recargo); recargo nocturno y dominical/festivo =
 *     horas × valor hora × recargo. No aplican a salario integral.
 *   - Auxilio de transporte ÷ 30 × días si el salario es hasta 2 SMMLV (no para integral). No hace parte del IBC.
 *   - IBC = devengos salariales (integral: 70 %), mínimo 1 SMMLV y máximo 25 SMMLV proporcionales a los días.
 *   - Empleado: salud y pensión sobre el IBC; Fondo de Solidaridad Pensional 1 % desde 4 SMMLV (1,2 % a 2 % desde
 *     16 SMMLV). Retención en la fuente y otros descuentos se digitan.
 *   - Empleador: salud, pensión, ARL (por clase de riesgo), caja, ICBF y SENA sobre el IBC; salud, ICBF y SENA en 0
 *     si la empresa está exonerada (art. 114-1 E.T.) y el empleado gana menos de 10 SMMLV.
 *   - Provisiones: cesantías y prima = (devengos salariales + auxilio) ÷ 12; intereses = 12 % de las cesantías;
 *     vacaciones = básico ÷ 24. Salario integral: sin cesantías, intereses ni prima.
 *   - Asiento al aprobar: gastos 5105xx contra 2370xx/2380xx/2365xx (aportes y retenciones), 2510–2525 (prestaciones)
 *     y 250505 Salarios por pagar. Pago: 250505 contra caja o bancos.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  createPayrollRunSchema,
  employeeSchema,
  payPayrollSchema,
  payrollItemSchema,
  payrollSettingsSchema,
  toggleCustomerSchema,
  voidCashReceiptSchema,
} from "@betel/contracts";
import { allowRoles, type MembershipRole } from "./auth.js";
import { assertBalanced, ensureDefaultAccounts } from "./accounting.js";
import { methodAccount, methodLabels } from "./collections.js";
import { getDianProvider } from "./dian.js";
import { todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;

/** Nómina: administración y contabilidad (los vendedores y lectores no ven salarios). */
export const PAYROLL_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];

/** Tarifas ARL por clase de riesgo (Decreto 1772 de 1994, tarifa inicial de cada clase). */
export const ARL_RATES: Record<number, number> = { 1: 0.522, 2: 1.044, 3: 2.436, 4: 4.35, 5: 6.96 };

export type Settings = {
  minimumWage: number;
  transportAllowance: number;
  monthlyHours: number;
  overtimeDayPct: number;
  overtimeNightPct: number;
  nightSurchargePct: number;
  holidaySurchargePct: number;
  healthEmployeePct: number;
  pensionEmployeePct: number;
  healthEmployerPct: number;
  pensionEmployerPct: number;
  compensationFundPct: number;
  icbfPct: number;
  senaPct: number;
  exempt: boolean;
};

/**
 * Valores propuestos cuando un año aún no tiene parámetros: los de 2025 (Decretos 1572 y 1573 de 2024; jornada de
 * 44 horas desde julio de 2025 → 220 horas mensuales; recargo dominical 80 % desde julio de 2025). Deben revisarse y
 * confirmarse con los decretos del año antes de liquidar.
 */
export const PROPOSED_SETTINGS: Settings & { basedOn: number } = {
  basedOn: 2025,
  minimumWage: 1423500,
  transportAllowance: 200000,
  monthlyHours: 220,
  overtimeDayPct: 25,
  overtimeNightPct: 75,
  nightSurchargePct: 35,
  holidaySurchargePct: 80,
  healthEmployeePct: 4,
  pensionEmployeePct: 4,
  healthEmployerPct: 8.5,
  pensionEmployerPct: 12,
  compensationFundPct: 4,
  icbfPct: 3,
  senaPct: 2,
  exempt: true,
};

// ─── Cálculos puros (probados en test/payroll.test.ts) ───────────────────────

const m2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const lastDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

/** Día en el mes comercial de 30 días (el último día del mes cuenta como 30). */
const commercialDay = (date: Date) => (date.getUTCDate() === lastDay(date) ? 30 : Math.min(date.getUTCDate(), 30));

/** Días comerciales (máx. 30) entre dos fechas del mismo mes, inclusive. */
export function commercialDays(start: Date, end: Date) {
  if (end < start) return 0;
  const startDay = start.getUTCDate() === 31 ? 30 : start.getUTCDate();
  return Math.max(0, Math.min(30, commercialDay(end) - startDay + 1));
}

/** Período de liquidación: mes completo o quincena 1 (1–15) / 2 (16–fin de mes). */
export function payrollPeriod(frequency: "BIWEEKLY" | "MONTHLY", year: number, month: number, half?: number) {
  const end = new Date(Date.UTC(year, month, 0));
  if (frequency === "MONTHLY") return { start: utc(year, month, 1), end };
  return half === 2 ? { start: utc(year, month, 16), end } : { start: utc(year, month, 1), end: utc(year, month, 15) };
}

/** Tasa del Fondo de Solidaridad Pensional según el IBC mensual en SMMLV. */
export function solidarityRate(monthlyIbc: number, minimumWage: number) {
  const ratio = monthlyIbc / minimumWage;
  if (ratio < 4) return 0;
  if (ratio < 16) return 1;
  if (ratio < 17) return 1.2;
  if (ratio < 18) return 1.4;
  if (ratio < 19) return 1.6;
  if (ratio < 20) return 1.8;
  return 2;
}

export type Novelties = {
  days: number;
  overtimeDay: number;
  overtimeNight: number;
  nightHours: number;
  holidayHours: number;
  salaryBonus: number;
  nonSalaryBonus: number;
  withholding: number;
  otherDeductions: number;
};

/** Liquida a un empleado para el período (ver CÁLCULO). Todos los valores redondeados a centavos. */
export function calculatePayroll(
  employee: { salary: number; salaryType: "ORDINARY" | "INTEGRAL"; riskClass: number },
  novelties: Novelties,
  settings: Settings
) {
  const integral = employee.salaryType === "INTEGRAL";
  const { days } = novelties;
  const hourValue = employee.salary / settings.monthlyHours;
  const basicPay = m2((employee.salary / 30) * days);
  const extra = (hours: number, pct: number, base: boolean) =>
    integral ? 0 : m2(hours * hourValue * ((base ? 1 : 0) + pct / 100));
  const overtimeDayPay = extra(novelties.overtimeDay, settings.overtimeDayPct, true);
  const overtimeNightPay = extra(novelties.overtimeNight, settings.overtimeNightPct, true);
  const nightSurchargePay = extra(novelties.nightHours, settings.nightSurchargePct, false);
  const holidaySurchargePay = extra(novelties.holidayHours, settings.holidaySurchargePct, false);
  const overtimePay = m2(overtimeDayPay + overtimeNightPay + nightSurchargePay + holidaySurchargePay);
  const transportEligible = !integral && employee.salary <= 2 * settings.minimumWage;
  const transport = transportEligible ? m2((settings.transportAllowance / 30) * days) : 0;
  const salaryIncome = m2(basicPay + overtimePay + novelties.salaryBonus);

  // IBC: devengos salariales (integral 70 %), entre 1 y 25 SMMLV proporcionales a los días.
  let ibc = integral ? salaryIncome * 0.7 : salaryIncome;
  if (days > 0) {
    ibc = Math.max(ibc, (settings.minimumWage / 30) * days);
    ibc = Math.min(ibc, ((25 * settings.minimumWage) / 30) * days);
  }
  ibc = m2(ibc);
  const monthlyIbc = days > 0 ? (ibc * 30) / days : ibc;
  const healthEmployee = m2((ibc * settings.healthEmployeePct) / 100);
  const pensionEmployee = m2((ibc * settings.pensionEmployeePct) / 100);
  const solidarityPct = solidarityRate(monthlyIbc, settings.minimumWage);
  const solidarity = m2((ibc * solidarityPct) / 100);

  const earnings = m2(salaryIncome + transport + novelties.nonSalaryBonus);
  const deductions = m2(
    healthEmployee + pensionEmployee + solidarity + novelties.withholding + novelties.otherDeductions
  );

  const exemptEmployee = settings.exempt && employee.salary < 10 * settings.minimumWage;
  const arlRate = ARL_RATES[employee.riskClass] ?? ARL_RATES[1]!;
  const healthEmployer = exemptEmployee ? 0 : m2((ibc * settings.healthEmployerPct) / 100);
  const pensionEmployer = m2((ibc * settings.pensionEmployerPct) / 100);
  const arl = m2((ibc * arlRate) / 100);
  const compensation = m2((ibc * settings.compensationFundPct) / 100);
  const icbf = exemptEmployee ? 0 : m2((ibc * settings.icbfPct) / 100);
  const sena = exemptEmployee ? 0 : m2((ibc * settings.senaPct) / 100);

  const provisionBase = salaryIncome + transport;
  const severance = integral ? 0 : m2(provisionBase / 12);
  const severanceInterest = integral ? 0 : m2(severance * 0.12);
  const serviceBonus = integral ? 0 : m2(provisionBase / 12);
  const vacation = m2(basicPay / 24);

  const contributions = m2(healthEmployer + pensionEmployer + arl + compensation + icbf + sena);
  const provisions = m2(severance + severanceInterest + serviceBonus + vacation);
  return {
    days,
    hourValue: m2(hourValue),
    basicPay,
    overtimeDayPay,
    overtimeNightPay,
    nightSurchargePay,
    holidaySurchargePay,
    overtimePay,
    transport,
    transportEligible,
    salaryBonus: novelties.salaryBonus,
    nonSalaryBonus: novelties.nonSalaryBonus,
    ibc,
    healthEmployee,
    pensionEmployee,
    solidarityPct,
    solidarity,
    withholding: novelties.withholding,
    otherDeductions: novelties.otherDeductions,
    earnings,
    deductions,
    netPay: m2(earnings - deductions),
    exemptEmployee,
    healthEmployer,
    pensionEmployer,
    arlRate,
    arl,
    compensation,
    icbf,
    sena,
    contributions,
    severance,
    severanceInterest,
    serviceBonus,
    vacation,
    provisions,
    employerCost: m2(contributions + provisions),
  };
}

export type Calculation = ReturnType<typeof calculatePayroll>;

/** Asiento de causación de una liquidación (suma de los cálculos por empleado). */
export function payrollJournal(calculations: Calculation[], accounts: Record<string, { id: string }>) {
  const sum = (field: keyof Calculation) => m2(calculations.reduce((total, item) => total + Number(item[field]), 0));
  const debits: [string, number, string][] = [
    ["510506", sum("basicPay"), "Sueldos"],
    ["510515", sum("overtimePay"), "Horas extra y recargos"],
    ["510548", m2(sum("salaryBonus") + sum("nonSalaryBonus")), "Bonificaciones"],
    ["510527", sum("transport"), "Auxilio de transporte"],
    ["510569", sum("healthEmployer"), "Aportes a EPS"],
    ["510570", sum("pensionEmployer"), "Aportes a fondos de pensiones"],
    ["510568", sum("arl"), "Aportes a ARL"],
    ["510572", sum("compensation"), "Aportes a caja de compensación"],
    ["510575", sum("icbf"), "Aportes al ICBF"],
    ["510578", sum("sena"), "Aportes al SENA"],
    ["510530", sum("severance"), "Cesantías"],
    ["510533", sum("severanceInterest"), "Intereses sobre cesantías"],
    ["510536", sum("serviceBonus"), "Prima de servicios"],
    ["510539", sum("vacation"), "Vacaciones"],
  ];
  const credits: [string, number, string][] = [
    ["237005", m2(sum("healthEmployee") + sum("healthEmployer")), "Aportes a EPS por pagar"],
    [
      "238030",
      m2(sum("pensionEmployee") + sum("solidarity") + sum("pensionEmployer")),
      "Aportes a pensiones por pagar",
    ],
    ["237006", sum("arl"), "Aportes a ARL por pagar"],
    ["237010", m2(sum("compensation") + sum("icbf") + sum("sena")), "Aportes parafiscales por pagar"],
    ["236505", sum("withholding"), "Retención en la fuente salarios"],
    ["237095", sum("otherDeductions"), "Otros descuentos de nómina"],
    ["251005", sum("severance"), "Cesantías consolidadas"],
    ["251505", sum("severanceInterest"), "Intereses sobre cesantías"],
    ["252005", sum("serviceBonus"), "Prima de servicios"],
    ["252505", sum("vacation"), "Vacaciones consolidadas"],
    ["250505", sum("netPay"), "Salarios por pagar"],
  ];
  return [
    ...debits
      .filter(([, value]) => value > 0)
      .map(([code, value, memo]) => ({ accountId: accounts[code]!.id, debit: value, credit: 0, memo })),
    ...credits
      .filter(([, value]) => value > 0)
      .map(([code, value, memo]) => ({ accountId: accounts[code]!.id, debit: 0, credit: value, memo })),
  ];
}

export const PAYROLL_ACCOUNTS: [string, string, string][] = [
  ["510506", "Sueldos", "EXPENSE"],
  ["510515", "Horas extras y recargos", "EXPENSE"],
  ["510527", "Auxilio de transporte", "EXPENSE"],
  ["510530", "Cesantías", "EXPENSE"],
  ["510533", "Intereses sobre cesantías", "EXPENSE"],
  ["510536", "Prima de servicios", "EXPENSE"],
  ["510539", "Vacaciones", "EXPENSE"],
  ["510548", "Bonificaciones", "EXPENSE"],
  ["510568", "Aportes a administradoras de riesgos laborales", "EXPENSE"],
  ["510569", "Aportes a entidades promotoras de salud", "EXPENSE"],
  ["510570", "Aportes a fondos de pensiones", "EXPENSE"],
  ["510572", "Aportes cajas de compensación familiar", "EXPENSE"],
  ["510575", "Aportes ICBF", "EXPENSE"],
  ["510578", "SENA", "EXPENSE"],
  ["236505", "Retención en la fuente — salarios", "LIABILITY"],
  ["237005", "Aportes a EPS por pagar", "LIABILITY"],
  ["237006", "Aportes a ARL por pagar", "LIABILITY"],
  ["237010", "Aportes parafiscales por pagar", "LIABILITY"],
  ["237095", "Otros descuentos de nómina", "LIABILITY"],
  ["238030", "Fondos de pensiones por pagar", "LIABILITY"],
  ["250505", "Salarios por pagar", "LIABILITY"],
  ["251005", "Cesantías consolidadas", "LIABILITY"],
  ["251505", "Intereses sobre cesantías", "LIABILITY"],
  ["252005", "Prima de servicios por pagar", "LIABILITY"],
  ["252505", "Vacaciones consolidadas", "LIABILITY"],
];

export const payrollNumber = (number: number) => `NOM-${number}`;

// ─── Consultas ────────────────────────────────────────────────────────────────

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const toNumber = (value: Prisma.Decimal | number) => (typeof value === "number" ? value : value.toNumber());

function settingsFromRow(row: Prisma.PayrollSettingsGetPayload<object>): Settings {
  return {
    minimumWage: toNumber(row.minimumWage),
    transportAllowance: toNumber(row.transportAllowance),
    monthlyHours: row.monthlyHours,
    overtimeDayPct: toNumber(row.overtimeDayPct),
    overtimeNightPct: toNumber(row.overtimeNightPct),
    nightSurchargePct: toNumber(row.nightSurchargePct),
    holidaySurchargePct: toNumber(row.holidaySurchargePct),
    healthEmployeePct: toNumber(row.healthEmployeePct),
    pensionEmployeePct: toNumber(row.pensionEmployeePct),
    healthEmployerPct: toNumber(row.healthEmployerPct),
    pensionEmployerPct: toNumber(row.pensionEmployerPct),
    compensationFundPct: toNumber(row.compensationFundPct),
    icbfPct: toNumber(row.icbfPct),
    senaPct: toNumber(row.senaPct),
    exempt: row.exempt,
  };
}

/** Parámetros confirmados del año o error 422 que explica qué hacer. */
async function confirmedSettings(tx: Tx, year: number) {
  const row = await tx.payrollSettings.findFirst({ where: { year } });
  if (!row?.confirmed)
    throw httpError(422, `Primero revisa y confirma los parámetros de nómina de ${year} (Nómina › Parámetros).`);
  return settingsFromRow(row);
}

function novelties(item: Prisma.PayrollItemGetPayload<object>): Novelties {
  return {
    days: item.days,
    overtimeDay: toNumber(item.overtimeDay),
    overtimeNight: toNumber(item.overtimeNight),
    nightHours: toNumber(item.nightHours),
    holidayHours: toNumber(item.holidayHours),
    salaryBonus: toNumber(item.salaryBonus),
    nonSalaryBonus: toNumber(item.nonSalaryBonus),
    withholding: toNumber(item.withholding),
    otherDeductions: toNumber(item.otherDeductions),
  };
}

/** Recalcula los totales de la liquidación a partir de sus renglones. */
async function refreshTotals(tx: Tx, runId: string) {
  const totals = await tx.payrollItem.aggregate({
    where: { runId },
    _sum: { earnings: true, deductions: true, netPay: true, employerCost: true },
  });
  await tx.payrollRun.update({
    where: { id: runId },
    data: {
      totalEarnings: totals._sum.earnings ?? 0,
      totalDeductions: totals._sum.deductions ?? 0,
      netPay: totals._sum.netPay ?? 0,
      employerCost: totals._sum.employerCost ?? 0,
    },
  });
}

const employeeSelect = {
  id: true,
  identificationType: true,
  identificationNumber: true,
  firstName: true,
  lastName: true,
  position: true,
  salary: true,
  salaryType: true,
  frequency: true,
  riskClass: true,
  healthFund: true,
  pensionFund: true,
  severanceFund: true,
  bankName: true,
  bankAccount: true,
  email: true,
} satisfies Prisma.EmployeeSelect;

function presentRun(run: Prisma.PayrollRunGetPayload<{ include: { _count: { select: { items: true } } } }>) {
  return {
    id: run.id,
    number: payrollNumber(run.number),
    frequency: run.frequency,
    periodStart: iso(run.periodStart),
    periodEnd: iso(run.periodEnd),
    status: run.status,
    totalEarnings: run.totalEarnings.toFixed(2),
    totalDeductions: run.totalDeductions.toFixed(2),
    netPay: run.netPay.toFixed(2),
    employerCost: run.employerCost.toFixed(2),
    employees: run._count.items,
    approvedAt: run.approvedAt?.toISOString() ?? null,
    paidAt: run.paidAt ? iso(run.paidAt) : null,
    paymentMethod: run.paymentMethod,
    voidReason: run.voidReason,
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerPayrollRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const can = { preHandler: allowRoles(...PAYROLL_ROLES) };
  const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  const audit = (
    tx: Tx,
    request: { ip: string; actor?: { organizationId: string; sub: string } },
    entity: string,
    entityId: string,
    action: string,
    after: Prisma.InputJsonValue
  ) =>
    tx.auditLog.create({
      data: {
        organizationId: request.actor!.organizationId,
        userId: request.actor!.sub,
        entity,
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });
  const accountsWithPayroll = async (tx: Tx, organizationId: string) => {
    const base = await ensureDefaultAccounts(tx, organizationId);
    const extra = await Promise.all(
      PAYROLL_ACCOUNTS.map(([code, name, accountType]) =>
        tx.account.upsert({
          where: { organizationId_code: { organizationId, code } },
          update: {},
          create: { organizationId, code, name, accountType },
        })
      )
    );
    return { ...base, ...Object.fromEntries(extra.map(account => [account.code, account])) } as Record<
      string,
      { id: string }
    >;
  };
  const year = (value: string) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : null;
  };

  // ── Parámetros ──

  /** GET /v1/payroll/settings/:year — guardados o propuestos (con aviso). */
  app.get<{ Params: { year: string } }>("/v1/payroll/settings/:year", can, async (request, reply) => {
    const value = year(request.params.year);
    if (!value) return reply.code(422).send({ error: "Año inválido." });
    const row = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.payrollSettings.findFirst({ where: { year: value } })
    );
    if (!row) {
      const { basedOn, ...proposed } = PROPOSED_SETTINGS;
      return { data: { year: value, ...proposed, confirmed: false, saved: false, basedOn } };
    }
    return {
      data: {
        year: value,
        ...settingsFromRow(row),
        confirmed: row.confirmed,
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
        saved: true,
        basedOn: null,
      },
    };
  });

  /** PUT /v1/payroll/settings/:year — Body: payrollSettingsSchema. */
  app.put<{ Params: { year: string } }>("/v1/payroll/settings/:year", can, async (request, reply) => {
    const value = year(request.params.year);
    if (!value) return reply.code(422).send({ error: "Año inválido." });
    const parsed = payrollSettingsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: parsed.error.issues[0]?.message ?? "Parámetros inválidos", details: parsed.error.flatten() });
    const { confirmed, ...values } = parsed.data;
    const saved = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const data = {
        ...values,
        confirmed,
        confirmedAt: confirmed ? new Date() : null,
        confirmedById: confirmed ? request.actor!.sub : null,
      };
      const row = await tx.payrollSettings.upsert({
        where: { organizationId_year: { organizationId: request.actor!.organizationId, year: value } },
        update: data,
        create: { ...data, organizationId: request.actor!.organizationId, year: value },
      });
      await audit(
        tx,
        request,
        "PayrollSettings",
        String(value),
        confirmed ? "CONFIRM" : "UPDATE",
        parsed.data as Prisma.InputJsonValue
      );
      return row;
    });
    return { data: { year: value, confirmed: saved.confirmed } };
  });

  // ── Empleados ──

  app.get<{ Querystring: { search?: string; status?: string } }>("/v1/payroll/employees", can, async request => {
    const search = request.query.search?.trim().slice(0, 120);
    const status = request.query.status ?? "ACTIVE";
    const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
    const rows = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.employee.findMany({
        where: {
          ...(status !== "ALL" && { active: status === "ACTIVE" }),
          ...(search && {
            OR: [
              { firstName: contains(search) },
              { lastName: contains(search) },
              { identificationNumber: { contains: search } },
              { position: contains(search) },
            ],
          }),
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 500,
      })
    );
    return {
      data: rows.map(row => ({
        ...row,
        salary: row.salary.toFixed(2),
        startDate: iso(row.startDate),
        endDate: row.endDate ? iso(row.endDate) : null,
        createdAt: undefined,
        updatedAt: undefined,
        organizationId: undefined,
      })),
    };
  });

  const saveEmployee = async (tx: Tx, organizationId: string, body: ReturnType<typeof employeeSchema.parse>) => {
    // Salario integral: al menos 13 SMMLV del año de ingreso (si sus parámetros están guardados).
    if (body.salaryType === "INTEGRAL") {
      const settings = await tx.payrollSettings.findFirst({
        where: { year: todayIn("America/Bogota").getUTCFullYear() },
      });
      const minimum = (settings ? toNumber(settings.minimumWage) : PROPOSED_SETTINGS.minimumWage) * 13;
      if (body.salary < minimum)
        throw httpError(422, `El salario integral debe ser de al menos 13 SMMLV (${minimum.toFixed(0)}).`);
    }
    return { ...body, organizationId, endDate: body.endDate ?? null };
  };

  app.post("/v1/payroll/employees", can, async (request, reply) => {
    const parsed = employeeSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: parsed.error.issues[0]?.message ?? "Empleado inválido", details: parsed.error.flatten() });
    try {
      const created = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const row = await tx.employee.create({
          data: await saveEmployee(tx, request.actor!.organizationId, parsed.data),
        });
        await audit(tx, request, "Employee", row.id, "CREATE", {
          name: `${row.firstName} ${row.lastName}`,
          salary: row.salary.toFixed(2),
        });
        return row;
      });
      return reply.code(201).send({ data: { id: created.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Ya existe un empleado con esa identificación." });
      throw error;
    }
  });

  app.put<{ Params: { id: string } }>("/v1/payroll/employees/:id", can, async (request, reply) => {
    const parsed = employeeSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: parsed.error.issues[0]?.message ?? "Empleado inválido", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Empleado no encontrado." });
    try {
      const updated = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const current = await tx.employee.findFirst({ where: { id: request.params.id } });
        if (!current) throw httpError(404, "Empleado no encontrado.");
        const row = await tx.employee.update({
          where: { id: current.id },
          data: await saveEmployee(tx, request.actor!.organizationId, parsed.data),
        });
        await audit(tx, request, "Employee", row.id, "UPDATE", {
          before: { salary: current.salary.toFixed(2), position: current.position },
          after: { salary: row.salary.toFixed(2), position: row.position },
        });
        return row;
      });
      return { data: { id: updated.id } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Ya existe un empleado con esa identificación." });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/v1/payroll/employees/:id/active", can, async (request, reply) => {
    const parsed = toggleCustomerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Indica si queda activo." });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Empleado no encontrado." });
    const count = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.employee.updateMany({
        where: { id: request.params.id },
        data: { active: parsed.data.active },
      });
      if (result.count)
        await audit(tx, request, "Employee", request.params.id, parsed.data.active ? "ACTIVATE" : "DEACTIVATE", {
          active: parsed.data.active,
        });
      return result.count;
    });
    if (!count) return reply.code(404).send({ error: "Empleado no encontrado." });
    return { data: { id: request.params.id, active: parsed.data.active } };
  });

  // ── Liquidaciones ──

  app.get<{ Querystring: { year?: string } }>("/v1/payroll/runs", can, async request => {
    const value = year(request.query.year ?? "") ?? todayIn("America/Bogota").getUTCFullYear();
    const runs = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.payrollRun.findMany({
        where: { periodEnd: { gte: utc(value, 1, 1), lte: utc(value, 12, 31) } },
        include: { _count: { select: { items: true } } },
        orderBy: [{ periodEnd: "desc" }, { number: "desc" }],
      })
    );
    return { data: runs.map(presentRun), year: value };
  });

  /** POST /v1/payroll/runs — crea la liquidación en borrador con los empleados activos de esa frecuencia. */
  app.post("/v1/payroll/runs", can, async (request, reply) => {
    const parsed = createPayrollRunSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Período inválido", details: parsed.error.flatten() });
    const { frequency, year: runYear, month, half } = parsed.data;
    if (frequency === "BIWEEKLY" && !half) return reply.code(422).send({ error: "Indica la quincena (1 o 2)." });
    const period = payrollPeriod(frequency, runYear, month, half);
    if (period.start > todayIn("America/Bogota"))
      return reply.code(422).send({ error: "No se puede liquidar un período futuro." });
    try {
      const run = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const settings = await confirmedSettings(tx, runYear);
        const overlapping = await tx.payrollRun.findFirst({
          where: {
            frequency,
            status: { not: "VOID" },
            periodStart: { lte: period.end },
            periodEnd: { gte: period.start },
          },
          select: { number: true },
        });
        if (overlapping)
          throw httpError(
            409,
            `Ese período ya está liquidado en ${payrollNumber(overlapping.number)}. Anúlala para volver a liquidar.`
          );
        const employees = await tx.employee.findMany({
          where: {
            active: true,
            frequency,
            startDate: { lte: period.end },
            OR: [{ endDate: null }, { endDate: { gte: period.start } }],
          },
        });
        if (!employees.length)
          throw httpError(
            422,
            `No hay empleados activos con pago ${frequency === "MONTHLY" ? "mensual" : "quincenal"} en ese período.`
          );
        const last = await tx.payrollRun.aggregate({ _max: { number: true } });
        const created = await tx.payrollRun.create({
          data: {
            organizationId: request.actor!.organizationId,
            number: (last._max.number ?? 0) + 1,
            frequency,
            periodStart: period.start,
            periodEnd: period.end,
            createdById: request.actor!.sub,
          },
        });
        for (const employee of employees) {
          const from = employee.startDate > period.start ? employee.startDate : period.start;
          const to = employee.endDate && employee.endDate < period.end ? employee.endDate : period.end;
          const days = Math.min(commercialDays(from, to), frequency === "BIWEEKLY" ? 15 : 30);
          const input: Novelties = {
            days,
            overtimeDay: 0,
            overtimeNight: 0,
            nightHours: 0,
            holidayHours: 0,
            salaryBonus: 0,
            nonSalaryBonus: 0,
            withholding: 0,
            otherDeductions: 0,
          };
          const calculation = calculatePayroll(
            { salary: toNumber(employee.salary), salaryType: employee.salaryType, riskClass: employee.riskClass },
            input,
            settings
          );
          await tx.payrollItem.create({
            data: {
              runId: created.id,
              employeeId: employee.id,
              days,
              earnings: calculation.earnings,
              deductions: calculation.deductions,
              netPay: calculation.netPay,
              employerCost: calculation.employerCost,
              calculation: calculation as unknown as Prisma.InputJsonValue,
            },
          });
        }
        await refreshTotals(tx, created.id);
        await audit(tx, request, "PayrollRun", created.id, "CREATE", {
          number: payrollNumber(created.number),
          period: [iso(period.start), iso(period.end)],
          employees: employees.length,
        });
        return created;
      });
      return reply.code(201).send({ data: { id: run.id, number: payrollNumber(run.number) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otra liquidación tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /** GET /v1/payroll/runs/:id — detalle con empleados, novedades y cálculo. */
  app.get<{ Params: { id: string } }>("/v1/payroll/runs/:id", can, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Liquidación no encontrada." });
    const run = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const found = await tx.payrollRun.findFirst({
        where: { id: request.params.id },
        include: {
          _count: { select: { items: true } },
          items: { include: { employee: { select: employeeSelect } }, orderBy: { employee: { lastName: "asc" } } },
        },
      });
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: request.actor!.organizationId },
        select: { legalName: true, nit: true },
      });
      return found && { found, organization };
    });
    if (!run) return reply.code(404).send({ error: "Liquidación no encontrada." });
    return {
      data: {
        ...presentRun(run.found),
        organization: run.organization,
        items: run.found.items.map(item => ({
          id: item.id,
          employee: { ...item.employee, salary: item.employee.salary.toFixed(2) },
          novelties: {
            ...novelties(item),
            notes: item.notes,
          },
          earnings: item.earnings.toFixed(2),
          deductions: item.deductions.toFixed(2),
          netPay: item.netPay.toFixed(2),
          employerCost: item.employerCost.toFixed(2),
          calculation: item.calculation,
        })),
      },
    };
  });

  /** PUT /v1/payroll/runs/:id/items/:itemId — novedades (borrador) y recálculo. */
  app.put<{ Params: { id: string; itemId: string } }>(
    "/v1/payroll/runs/:id/items/:itemId",
    can,
    async (request, reply) => {
      const parsed = payrollItemSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(422)
          .send({ error: parsed.error.issues[0]?.message ?? "Novedades inválidas", details: parsed.error.flatten() });
      if (!validId(request.params.id) || !validId(request.params.itemId))
        return reply.code(404).send({ error: "Renglón no encontrado." });
      const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const item = await tx.payrollItem.findFirst({
          where: { id: request.params.itemId, runId: request.params.id },
          include: { run: true, employee: true },
        });
        if (!item) throw httpError(404, "Renglón no encontrado.");
        if (item.run.status !== "DRAFT")
          throw httpError(409, "Solo se editan novedades de una liquidación en borrador.");
        const limit = item.run.frequency === "BIWEEKLY" ? 15 : 30;
        if (parsed.data.days > limit)
          throw httpError(422, `Una liquidación ${limit === 15 ? "quincenal" : "mensual"} tiene máximo ${limit} días.`);
        const hours =
          parsed.data.overtimeDay + parsed.data.overtimeNight + parsed.data.nightHours + parsed.data.holidayHours;
        if (item.employee.salaryType === "INTEGRAL" && hours > 0)
          throw httpError(422, "El salario integral ya incluye horas extra y recargos.");
        const settings = await confirmedSettings(tx, item.run.periodEnd.getUTCFullYear());
        const { notes, ...values } = parsed.data;
        const calculation = calculatePayroll(
          {
            salary: toNumber(item.employee.salary),
            salaryType: item.employee.salaryType,
            riskClass: item.employee.riskClass,
          },
          values,
          settings
        );
        await tx.payrollItem.update({
          where: { id: item.id },
          data: {
            ...values,
            notes: notes || null,
            earnings: calculation.earnings,
            deductions: calculation.deductions,
            netPay: calculation.netPay,
            employerCost: calculation.employerCost,
            calculation: calculation as unknown as Prisma.InputJsonValue,
          },
        });
        if (calculation.netPay < 0)
          throw httpError(422, "Las deducciones superan lo devengado: revisa los descuentos.");
        await refreshTotals(tx, item.runId);
        return calculation;
      });
      return { data: result };
    }
  );

  /** POST /v1/payroll/runs/:id/approve — contabiliza la causación. */
  app.post<{ Params: { id: string } }>("/v1/payroll/runs/:id/approve", can, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Liquidación no encontrada." });
    const approved = await withOrganizationScope(request.actor!.organizationId, async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${request.params.id} FOR UPDATE`;
      const run = await tx.payrollRun.findFirst({ where: { id: request.params.id }, include: { items: true } });
      if (!run) throw httpError(404, "Liquidación no encontrada.");
      if (run.status !== "DRAFT") throw httpError(409, "Solo se aprueba una liquidación en borrador.");
      // Se recalcula con los parámetros confirmados vigentes por si cambiaron después de digitar novedades.
      const settings = await confirmedSettings(tx, run.periodEnd.getUTCFullYear());
      const employees = await tx.employee.findMany({ where: { id: { in: run.items.map(item => item.employeeId) } } });
      const byId = new Map(employees.map(employee => [employee.id, employee]));
      const calculations: Calculation[] = [];
      for (const item of run.items) {
        const employee = byId.get(item.employeeId)!;
        const calculation = calculatePayroll(
          { salary: toNumber(employee.salary), salaryType: employee.salaryType, riskClass: employee.riskClass },
          novelties(item),
          settings
        );
        calculations.push(calculation);
        await tx.payrollItem.update({
          where: { id: item.id },
          data: {
            earnings: calculation.earnings,
            deductions: calculation.deductions,
            netPay: calculation.netPay,
            employerCost: calculation.employerCost,
            calculation: calculation as unknown as Prisma.InputJsonValue,
          },
        });
      }
      await refreshTotals(tx, run.id);
      const accounts = await accountsWithPayroll(tx, request.actor!.organizationId);
      const lines = payrollJournal(calculations, accounts);
      assertBalanced(lines);
      await tx.journalEntry.create({
        data: {
          organizationId: request.actor!.organizationId,
          reference: payrollNumber(run.number),
          date: run.periodEnd,
          description: `Nómina ${iso(run.periodStart)} a ${iso(run.periodEnd)}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "PayrollRun",
          sourceId: run.id,
          lines: { create: lines },
        },
      });
      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      await audit(tx, request, "PayrollRun", run.id, "APPROVE", {
        number: payrollNumber(run.number),
        net: updated.netPay.toFixed(2),
      });
      return updated;
    });
    return { data: { id: approved.id, status: approved.status, netPay: approved.netPay.toFixed(2) } };
  });

  /** POST /v1/payroll/runs/:id/pay — Body: { date, method }. */
  app.post<{ Params: { id: string } }>("/v1/payroll/runs/:id/pay", can, async (request, reply) => {
    const parsed = payPayrollSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Indica la fecha y el medio de pago." });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Liquidación no encontrada." });
    if (parsed.data.date > todayIn("America/Bogota"))
      return reply.code(422).send({ error: "La fecha del pago no puede ser futura." });
    const paid = await withOrganizationScope(request.actor!.organizationId, async tx => {
      await tx.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${request.params.id} FOR UPDATE`;
      const run = await tx.payrollRun.findFirst({ where: { id: request.params.id } });
      if (!run) throw httpError(404, "Liquidación no encontrada.");
      if (run.status !== "APPROVED") throw httpError(409, "Solo se paga una liquidación aprobada y sin pagar.");
      const accounts = await accountsWithPayroll(tx, request.actor!.organizationId);
      const amount = run.netPay.toNumber();
      const lines = [
        { accountId: accounts["250505"]!.id, debit: amount, credit: 0, memo: "Pago de nómina" },
        {
          accountId: accounts[methodAccount(parsed.data.method)]!.id,
          debit: 0,
          credit: amount,
          memo: `Egreso ${methodLabels[parsed.data.method]}`,
        },
      ];
      assertBalanced(lines);
      await tx.journalEntry.create({
        data: {
          organizationId: request.actor!.organizationId,
          reference: `${payrollNumber(run.number)}-P`,
          date: parsed.data.date,
          description: `Pago de nómina ${payrollNumber(run.number)}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "PayrollRun",
          sourceId: run.id,
          lines: { create: lines },
        },
      });
      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: "PAID", paidAt: parsed.data.date, paymentMethod: parsed.data.method },
      });
      await audit(tx, request, "PayrollRun", run.id, "PAY", {
        method: parsed.data.method,
        amount: run.netPay.toFixed(2),
      });
      return updated;
    });
    return { data: { id: paid.id, status: paid.status } };
  });

  /** POST /v1/payroll/runs/:id/void — Body: { reason }. Borrador o aprobada sin pagar ni transmitir. */
  app.post<{ Params: { id: string } }>("/v1/payroll/runs/:id/void", can, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Indica el motivo de la anulación (mínimo 3 caracteres)." });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Liquidación no encontrada." });
    const voided = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const run = await tx.payrollRun.findFirst({
        where: { id: request.params.id },
        include: { items: { select: { employeeId: true } } },
      });
      if (!run) throw httpError(404, "Liquidación no encontrada.");
      if (run.status === "VOID") throw httpError(409, "Ya está anulada.");
      if (run.status === "PAID") throw httpError(409, "Ya se pagó: no se puede anular.");
      const transmitted = await tx.payrollElectronic.findFirst({
        where: {
          year: run.periodEnd.getUTCFullYear(),
          month: run.periodEnd.getUTCMonth() + 1,
          employeeId: { in: run.items.map(item => item.employeeId) },
        },
        select: { id: true },
      });
      if (transmitted) throw httpError(409, "La nómina electrónica de ese mes ya se transmitió: no se puede anular.");
      if (run.status === "APPROVED") {
        const entry = await tx.journalEntry.findFirst({
          where: { reference: payrollNumber(run.number), sourceType: "PayrollRun" },
          include: { lines: true },
        });
        if (entry) {
          const reversed = entry.lines.map(line => ({
            accountId: line.accountId,
            debit: line.credit.toNumber(),
            credit: line.debit.toNumber(),
            memo: `Anulación: ${line.memo ?? ""}`,
          }));
          assertBalanced(reversed);
          await tx.journalEntry.create({
            data: {
              organizationId: request.actor!.organizationId,
              reference: `${payrollNumber(run.number)}-A`,
              date: run.periodEnd,
              description: `Anulación de la nómina ${payrollNumber(run.number)}`,
              status: "POSTED",
              postedAt: new Date(),
              sourceType: "PayrollRun",
              sourceId: run.id,
              lines: { create: reversed },
            },
          });
        }
      }
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: "VOID", voidReason: parsed.data.reason } });
      await audit(tx, request, "PayrollRun", run.id, "VOID", { reason: parsed.data.reason });
      return run;
    });
    return { data: { id: voided.id, status: "VOID" } };
  });

  // ── Nómina electrónica ──

  const monthParams = (query: { year?: string; month?: string }) => {
    const y = year(query.year ?? "");
    const m = Number(query.month);
    return y && Number.isInteger(m) && m >= 1 && m <= 12 ? { year: y, month: m } : null;
  };

  /** Totales del mes por empleado (liquidaciones aprobadas o pagadas que terminan en el mes). */
  const monthTotals = async (tx: Tx, y: number, m: number) => {
    const items = await tx.payrollItem.findMany({
      where: {
        run: {
          status: { in: ["APPROVED", "PAID"] },
          periodEnd: { gte: utc(y, m, 1), lte: new Date(Date.UTC(y, m, 0)) },
        },
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, identificationType: true, identificationNumber: true },
        },
      },
    });
    const byEmployee = new Map<
      string,
      {
        employee: (typeof items)[number]["employee"];
        earnings: number;
        deductions: number;
        netPay: number;
        runs: number;
      }
    >();
    for (const item of items) {
      const current = byEmployee.get(item.employeeId) ?? {
        employee: item.employee,
        earnings: 0,
        deductions: 0,
        netPay: 0,
        runs: 0,
      };
      current.earnings = m2(current.earnings + item.earnings.toNumber());
      current.deductions = m2(current.deductions + item.deductions.toNumber());
      current.netPay = m2(current.netPay + item.netPay.toNumber());
      current.runs++;
      byEmployee.set(item.employeeId, current);
    }
    return byEmployee;
  };

  app.get<{ Querystring: { year?: string; month?: string } }>("/v1/payroll/electronic", can, async (request, reply) => {
    const params = monthParams(request.query);
    if (!params) return reply.code(422).send({ error: "Indica año y mes." });
    const data = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const totals = await monthTotals(tx, params.year, params.month);
      const documents = await tx.payrollElectronic.findMany({ where: { year: params.year, month: params.month } });
      const byEmployee = new Map(documents.map(document => [document.employeeId, document]));
      return [...totals.values()]
        .sort((a, b) => a.employee.lastName.localeCompare(b.employee.lastName))
        .map(row => {
          const document = byEmployee.get(row.employee.id);
          return {
            employee: row.employee,
            earnings: row.earnings.toFixed(2),
            deductions: row.deductions.toFixed(2),
            netPay: row.netPay.toFixed(2),
            runs: row.runs,
            document: document
              ? {
                  number: `NE-${document.number}`,
                  dianStatus: document.dianStatus,
                  netPay: document.netPay.toFixed(2),
                  outdated: document.netPay.toNumber() !== row.netPay || document.runCount !== row.runs,
                  updatedAt: document.updatedAt.toISOString(),
                }
              : null,
          };
        });
    });
    return { data, ...params };
  });

  /** POST /v1/payroll/electronic/:year/:month/transmit — genera y envía los documentos del mes. */
  app.post<{ Params: { year: string; month: string } }>(
    "/v1/payroll/electronic/:year/:month/transmit",
    can,
    async (request, reply) => {
      const params = monthParams(request.params);
      if (!params) return reply.code(422).send({ error: "Mes inválido." });
      const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-ne:${request.actor!.organizationId}`}))`;
        const totals = await monthTotals(tx, params.year, params.month);
        if (!totals.size) throw httpError(422, "No hay liquidaciones aprobadas o pagadas que terminen en ese mes.");
        let sent = 0;
        let skipped = 0;
        for (const row of totals.values()) {
          const existing = await tx.payrollElectronic.findUnique({
            where: {
              organizationId_employeeId_year_month: {
                organizationId: request.actor!.organizationId,
                employeeId: row.employee.id,
                year: params.year,
                month: params.month,
              },
            },
          });
          // Un documento aceptado por la DIAN no se reemplaza: se corrige con nota de ajuste (aún no disponible).
          if (existing?.dianStatus === "ACCEPTED") {
            skipped++;
            continue;
          }
          const number =
            existing?.number ??
            ((await tx.payrollElectronic.aggregate({ _max: { number: true } }))._max.number ?? 0) + 1;
          const document = existing
            ? await tx.payrollElectronic.update({
                where: { id: existing.id },
                data: {
                  earnings: row.earnings,
                  deductions: row.deductions,
                  netPay: row.netPay,
                  runCount: row.runs,
                  dianStatus: "PENDING",
                },
              })
            : await tx.payrollElectronic.create({
                data: {
                  organizationId: request.actor!.organizationId,
                  employeeId: row.employee.id,
                  year: params.year,
                  month: params.month,
                  number,
                  earnings: row.earnings,
                  deductions: row.deductions,
                  netPay: row.netPay,
                  runCount: row.runs,
                  dianStatus: "PENDING",
                },
              });
          const submission = await getDianProvider().submitPayroll({
            documentId: document.id,
            organizationId: request.actor!.organizationId,
            number: `NE-${number}`,
          });
          await tx.payrollElectronic.update({
            where: { id: document.id },
            data: {
              dianStatus: submission.status,
              providerResponse: submission.providerResponse as Prisma.InputJsonValue,
            },
          });
          sent++;
        }
        await audit(tx, request, "PayrollElectronic", `${params.year}-${params.month}`, "TRANSMIT", { sent, skipped });
        return { sent, skipped };
      });
      return reply.code(201).send({ data: result });
    }
  );
  // ── Certificado de ingresos y retenciones (Contabilidad › Más procesos › Certificados) ──

  /**
   * GET /v1/payroll/certificates?year= — por empleado, lo pagado en el año según las liquidaciones aprobadas o pagadas
   * que terminan en ese año: salarios (básico, extras, recargos y pagos salariales), auxilio de transporte, pagos no
   * salariales, aportes obligatorios del trabajador (salud; pensión y Fondo de Solidaridad) y retención en la fuente.
   */
  app.get<{ Querystring: { year?: string } }>("/v1/payroll/certificates", can, async (request, reply) => {
    const value = year(request.query.year ?? "");
    if (!value) return reply.code(422).send({ error: "Indica el año." });
    const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const items = await tx.payrollItem.findMany({
        where: {
          run: { status: { in: ["APPROVED", "PAID"] }, periodEnd: { gte: utc(value, 1, 1), lte: utc(value, 12, 31) } },
        },
        include: {
          run: { select: { periodStart: true, periodEnd: true } },
          employee: {
            select: {
              id: true,
              identificationType: true,
              identificationNumber: true,
              firstName: true,
              lastName: true,
              position: true,
            },
          },
        },
      });
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: request.actor!.organizationId },
        select: { legalName: true, nit: true, verificationDigit: true, address: true },
      });
      return { items, organization };
    });
    const byEmployee = new Map<string, ReturnType<typeof emptyCertificate>>();
    function emptyCertificate(item: (typeof result.items)[number]) {
      return {
        employee: item.employee,
        from: item.run.periodStart,
        to: item.run.periodEnd,
        runs: 0,
        salaries: 0,
        transport: 0,
        nonSalary: 0,
        health: 0,
        pension: 0,
        withholding: 0,
      };
    }
    for (const item of result.items) {
      const c = item.calculation as unknown as Calculation;
      const row = byEmployee.get(item.employeeId) ?? emptyCertificate(item);
      if (item.run.periodStart < row.from) row.from = item.run.periodStart;
      if (item.run.periodEnd > row.to) row.to = item.run.periodEnd;
      row.runs++;
      row.salaries = m2(row.salaries + c.basicPay + c.overtimePay + c.salaryBonus);
      row.transport = m2(row.transport + c.transport);
      row.nonSalary = m2(row.nonSalary + c.nonSalaryBonus);
      row.health = m2(row.health + c.healthEmployee);
      row.pension = m2(row.pension + c.pensionEmployee + c.solidarity);
      row.withholding = m2(row.withholding + c.withholding);
      byEmployee.set(item.employeeId, row);
    }
    return {
      data: [...byEmployee.values()]
        .sort((a, b) => a.employee.lastName.localeCompare(b.employee.lastName))
        .map(row => ({
          ...row,
          from: iso(row.from),
          to: iso(row.to),
          grossIncome: m2(row.salaries + row.transport + row.nonSalary),
        })),
      year: value,
      organization: result.organization,
    };
  });
}
