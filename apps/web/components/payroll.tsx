/**
 * Módulo "Nómina" (/nomina): pestañas Nóminas (liquidaciones), Empleados, Nómina electrónica y Parámetros.
 *
 * Solo OWNER, ADMIN y ACCOUNTANT (los salarios son información sensible; la API lo hace cumplir).
 * El detalle de una liquidación está en payroll-run.tsx y el desprendible en payroll-slip.tsx.
 * Cálculo y reglas en apps/api/src/payroll.ts y docs/nomina.md.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost, apiPut } from "../lib/api";
import { ActionMenu } from "./action-menu";
import { date, defaultPeriod, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { Modal } from "./collection-dialogs";
import { monthNames } from "./costing";

const tabs = [
  ["nominas", "Nóminas"],
  ["empleados", "Empleados"],
  ["electronica", "Nómina electrónica"],
  ["parametros", "Parámetros"],
] as const;

export const runStatusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  APPROVED: "Aprobada",
  PAID: "Pagada",
  VOID: "Anulada",
};
export const runStatusBadges: Record<string, string> = {
  DRAFT: "pay-badge is-pending",
  APPROVED: "pay-badge is-info",
  PAID: "pay-badge is-ok",
  VOID: "pay-badge",
};
export const frequencyLabels: Record<string, string> = { BIWEEKLY: "Quincenal", MONTHLY: "Mensual" };
export const runHref = (id: string) => `/nomina/liquidacion?id=${id}`;

export function PayrollModule() {
  const requested = useSearchParams().get("tab");
  const [slug] = tabs.find(([tab]) => tab === requested) ?? tabs[0];
  const { canReceive: allowed } = useSession();
  return (
    <div className="page-content">
      <nav className="report-tabs" aria-label="Nómina">
        {tabs.map(([tab, name]) => (
          <Link
            key={tab}
            href={`/nomina?tab=${tab}`}
            scroll={false}
            aria-current={tab === slug ? "page" : undefined}
            className={tab === slug ? "active" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>
      {!allowed ? (
        <section className="panel report-unavailable">
          <h2>Sin acceso a la nómina</h2>
          <p>
            Los salarios son información sensible: solo los roles Propietario, Administrador y Contador pueden ver la
            nómina.
          </p>
        </section>
      ) : (
        <>
          {slug === "nominas" && <PayrollRuns />}
          {slug === "empleados" && <Employees />}
          {slug === "electronica" && <ElectronicPayroll />}
          {slug === "parametros" && <PayrollSettingsForm />}
        </>
      )}
    </div>
  );
}

// ─── Nóminas (liquidaciones) ─────────────────────────────────────────────────

type RunRow = {
  id: string;
  number: string;
  frequency: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalEarnings: string;
  totalDeductions: string;
  netPay: string;
  employerCost: string;
  employees: number;
  paidAt: string | null;
};

function PayrollRuns() {
  const currentYear = Number(defaultPeriod().to.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const report = useReport<{ data: RunRow[] }>("/v1/payroll/runs", { year });
  const [creating, setCreating] = useState(false);
  const rows = report.data?.data ?? [];
  const active = rows.filter(row => row.status !== "VOID");
  const sum = (field: "totalEarnings" | "netPay" | "employerCost") =>
    active.reduce((total, row) => total + Number(row[field]), 0);
  return (
    <section className="panel collections">
      <div className="quotes-toolbar">
        <label className="field costing-year">
          Año
          <select value={year} onChange={event => setYear(Number(event.target.value))}>
            {Array.from({ length: 5 }, (_, index) => currentYear - index).map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span className="collections-spacer" />
        <button type="button" className="primary" onClick={() => setCreating(true)}>
          ＋ Nueva liquidación
        </button>
      </div>
      {active.length > 0 && (
        <div className="statement-kpis payroll-kpis">
          <div>
            <span>Devengado del año</span>
            <b>{money(sum("totalEarnings"))}</b>
          </div>
          <div>
            <span>Neto pagado o por pagar</span>
            <b>{money(sum("netPay"))}</b>
          </div>
          <div>
            <span>Aportes y provisiones del empleador</span>
            <b>{money(sum("employerCost"))}</b>
          </div>
          <div>
            <span>Liquidaciones vigentes</span>
            <b>{active.length}</b>
          </div>
        </div>
      )}
      <ReportStatus loading={report.loading && !report.data} error={report.error} />
      {report.data && (
        <div className="report-table-wrap">
          <table className="report-table collections-table">
            <thead>
              <tr>
                <th>Liquidación</th>
                <th>Período</th>
                <th>Frecuencia</th>
                <th className="num">Empleados</th>
                <th className="num">Devengado</th>
                <th className="num">Deducciones</th>
                <th className="num">Neto a pagar</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className={row.status === "VOID" ? "is-cancelled" : undefined}>
                  <td>
                    <Link href={runHref(row.id)} className="collections-doc">
                      {row.number}
                    </Link>
                  </td>
                  <td>
                    {date(row.periodStart)} – {date(row.periodEnd)}
                  </td>
                  <td>{frequencyLabels[row.frequency]}</td>
                  <td className="num">{row.employees}</td>
                  <td className="num">{money(row.totalEarnings)}</td>
                  <td className="num">{money(row.totalDeductions)}</td>
                  <td className="num">
                    <b>{money(row.netPay)}</b>
                  </td>
                  <td>
                    <span className={runStatusBadges[row.status]}>{runStatusLabels[row.status]}</span>
                    {row.paidAt && <small>Pagada el {date(row.paidAt)}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="report-message">
              No hay liquidaciones en {year}. Antes de la primera: confirma los parámetros del año y registra los
              empleados.
            </p>
          )}
        </div>
      )}
      {creating && <NewRunDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

function NewRunDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const today = defaultPeriod().to;
  const [form, setForm] = useState({
    frequency: "MONTHLY",
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    half: Number(today.slice(8, 10)) > 15 ? 2 : 1,
  });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const created = await apiPost<{ data: { id: string } }>("/v1/payroll/runs", {
        frequency: form.frequency,
        year: form.year,
        month: form.month,
        ...(form.frequency === "BIWEEKLY" && { half: form.half }),
      });
      router.push(runHref(created.data.id));
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title="Nueva liquidación de nómina" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          Se crea en borrador con los empleados activos de esa frecuencia y los días del período. Luego registras las
          novedades (horas extra, bonificaciones, descuentos) y la apruebas.
        </p>
        <label className="field">
          Frecuencia
          <select value={form.frequency} onChange={event => setForm({ ...form, frequency: event.target.value })}>
            <option value="MONTHLY">Mensual</option>
            <option value="BIWEEKLY">Quincenal</option>
          </select>
        </label>
        <div className="payroll-period">
          <label className="field">
            Mes
            <select value={form.month} onChange={event => setForm({ ...form, month: Number(event.target.value) })}>
              {monthNames.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Año
            <input
              type="number"
              min={2000}
              max={2100}
              value={form.year}
              onChange={event => setForm({ ...form, year: Number(event.target.value) })}
            />
          </label>
          {form.frequency === "BIWEEKLY" && (
            <label className="field">
              Quincena
              <select value={form.half} onChange={event => setForm({ ...form, half: Number(event.target.value) })}>
                <option value={1}>Primera (1–15)</option>
                <option value={2}>Segunda (16–fin de mes)</option>
              </select>
            </label>
          )}
        </div>
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={state.busy}>
            {state.busy ? "Creando…" : "Crear liquidación"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Empleados ───────────────────────────────────────────────────────────────

type EmployeeRow = {
  id: string;
  identificationType: string;
  identificationNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  position: string;
  startDate: string;
  endDate: string | null;
  contractType: string;
  salaryType: string;
  salary: string;
  frequency: string;
  riskClass: number;
  healthFund: string;
  pensionFund: string;
  severanceFund: string | null;
  bankName: string | null;
  bankAccount: string | null;
  active: boolean;
};
const contractLabels: Record<string, string> = {
  INDEFINITE: "Término indefinido",
  FIXED: "Término fijo",
  WORK: "Obra o labor",
};
const salaryTypeLabels: Record<string, string> = { ORDINARY: "Ordinario", INTEGRAL: "Integral" };

function Employees() {
  const [status, setStatus] = useState("ACTIVE");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const report = useReport<{ data: EmployeeRow[] }>("/v1/payroll/employees", { status, search: query });
  const [dialog, setDialog] = useState<EmployeeRow | "new" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const rows = report.data?.data ?? [];
  const toggle = async (row: EmployeeRow) => {
    setNotice(null);
    try {
      await apiPost(`/v1/payroll/employees/${row.id}/active`, { active: !row.active });
      setNotice({ kind: "ok", text: `${row.firstName} ${row.lastName} ${row.active ? "retirado" : "reactivado"}.` });
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };
  return (
    <section className="panel collections">
      <form
        className="quotes-toolbar"
        onSubmit={event => {
          event.preventDefault();
          setQuery(search.trim());
        }}
      >
        <span className="collections-search products-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar por nombre, identificación o cargo"
            aria-label="Buscar empleado"
          />
        </span>
        <label className="field payroll-status">
          <span className="sr-only">Estado</span>
          <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Estado">
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Retirados</option>
            <option value="ALL">Todos</option>
          </select>
        </label>
        <span className="collections-spacer" />
        <button type="button" className="primary" onClick={() => setDialog("new")}>
          ＋ Crear empleado
        </button>
      </form>
      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={report.loading && !report.data} error={report.error} />
      {report.data && (
        <div className="report-table-wrap">
          <table className="report-table collections-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Cargo</th>
                <th>Contrato</th>
                <th>Ingreso</th>
                <th className="num">Salario</th>
                <th>Pago</th>
                <th>Seguridad social</th>
                <th>Estado</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className={row.active ? undefined : "is-cancelled"}>
                  <td>
                    <button type="button" className="report-link collections-doc" onClick={() => setDialog(row)}>
                      {row.lastName} {row.firstName}
                    </button>
                    <small>
                      {row.identificationType} {row.identificationNumber}
                    </small>
                  </td>
                  <td>{row.position}</td>
                  <td>
                    {contractLabels[row.contractType]}
                    <small>Salario {salaryTypeLabels[row.salaryType].toLowerCase()}</small>
                  </td>
                  <td>
                    {date(row.startDate)}
                    {row.endDate && <small>Retiro {date(row.endDate)}</small>}
                  </td>
                  <td className="num">{money(row.salary)}</td>
                  <td>{frequencyLabels[row.frequency]}</td>
                  <td>
                    {row.healthFund} · {row.pensionFund}
                    <small>ARL clase {row.riskClass}</small>
                  </td>
                  <td>
                    <span className={row.active ? "pay-badge is-ok" : "pay-badge"}>
                      {row.active ? "Activo" : "Retirado"}
                    </span>
                  </td>
                  <td>
                    <ActionMenu
                      label={`Acciones de ${row.firstName}`}
                      className="secondary quotes-row-menu"
                      items={[
                        { label: "Editar", onSelect: () => setDialog(row) },
                        {
                          label: row.active ? "Retirar (inactivar)" : "Reactivar",
                          danger: row.active,
                          onSelect: () => toggle(row),
                        },
                      ]}
                    >
                      ⋯
                    </ActionMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="report-message">
              No hay empleados {status === "INACTIVE" ? "retirados" : query ? "con esa búsqueda" : "registrados"}.
            </p>
          )}
        </div>
      )}
      {dialog && (
        <EmployeeDialog
          employee={dialog === "new" ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={name => {
            setDialog(null);
            setNotice({ kind: "ok", text: `${name} guardado.` });
            report.reload();
          }}
        />
      )}
    </section>
  );
}

function EmployeeDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: EmployeeRow | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [form, setForm] = useState({
    identificationType: employee?.identificationType ?? "CC",
    identificationNumber: employee?.identificationNumber ?? "",
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    position: employee?.position ?? "",
    startDate: employee?.startDate ?? defaultPeriod().to,
    endDate: employee?.endDate ?? "",
    contractType: employee?.contractType ?? "INDEFINITE",
    salaryType: employee?.salaryType ?? "ORDINARY",
    salary: employee ? String(Number(employee.salary)) : "",
    frequency: employee?.frequency ?? "MONTHLY",
    riskClass: String(employee?.riskClass ?? 1),
    healthFund: employee?.healthFund ?? "",
    pensionFund: employee?.pensionFund ?? "",
    severanceFund: employee?.severanceFund ?? "",
    bankName: employee?.bankName ?? "",
    bankAccount: employee?.bankAccount ?? "",
  });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: event.target.value });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    const body = {
      ...form,
      salary: Number(form.salary),
      riskClass: Number(form.riskClass),
      endDate: form.endDate || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      severanceFund: form.severanceFund || undefined,
      bankName: form.bankName || undefined,
      bankAccount: form.bankAccount || undefined,
    };
    try {
      if (employee) await apiPut(`/v1/payroll/employees/${employee.id}`, body);
      else await apiPost("/v1/payroll/employees", body);
      onSaved(`${form.firstName} ${form.lastName}`);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title={employee ? "Editar empleado" : "Crear empleado"} onClose={onClose} wide>
      <form onSubmit={submit} className="events-form payroll-employee-form">
        <h3 className="events-form-full">Datos personales</h3>
        <label className="field">
          Tipo de documento
          <select value={form.identificationType} onChange={set("identificationType")}>
            <option value="CC">Cédula de ciudadanía</option>
            <option value="CE">Cédula de extranjería</option>
            <option value="PA">Pasaporte</option>
            <option value="PPT">Permiso por protección temporal</option>
            <option value="TI">Tarjeta de identidad</option>
          </select>
        </label>
        <label className="field">
          Número
          <input value={form.identificationNumber} onChange={set("identificationNumber")} required maxLength={20} />
        </label>
        <label className="field">
          Nombres
          <input value={form.firstName} onChange={set("firstName")} required maxLength={80} />
        </label>
        <label className="field">
          Apellidos
          <input value={form.lastName} onChange={set("lastName")} required maxLength={80} />
        </label>
        <label className="field">
          Correo (opcional)
          <input type="email" value={form.email} onChange={set("email")} />
        </label>
        <label className="field">
          Teléfono (opcional)
          <input value={form.phone} onChange={set("phone")} maxLength={30} />
        </label>
        <h3 className="events-form-full">Contrato</h3>
        <label className="field">
          Cargo
          <input value={form.position} onChange={set("position")} required maxLength={80} />
        </label>
        <label className="field">
          Tipo de contrato
          <select value={form.contractType} onChange={set("contractType")}>
            {Object.entries(contractLabels).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Fecha de ingreso
          <input type="date" value={form.startDate} onChange={set("startDate")} required />
        </label>
        <label className="field">
          Fecha de retiro (opcional)
          <input type="date" value={form.endDate} min={form.startDate} onChange={set("endDate")} />
        </label>
        <label className="field">
          Tipo de salario
          <select value={form.salaryType} onChange={set("salaryType")}>
            <option value="ORDINARY">Ordinario</option>
            <option value="INTEGRAL">Integral (mínimo 13 SMMLV)</option>
          </select>
        </label>
        <label className="field">
          Salario mensual
          <input type="number" min="1" step="0.01" value={form.salary} onChange={set("salary")} required />
        </label>
        <label className="field">
          Frecuencia de pago
          <select value={form.frequency} onChange={set("frequency")}>
            <option value="MONTHLY">Mensual</option>
            <option value="BIWEEKLY">Quincenal</option>
          </select>
        </label>
        <label className="field">
          Clase de riesgo ARL
          <select value={form.riskClass} onChange={set("riskClass")}>
            {[1, 2, 3, 4, 5].map(value => (
              <option key={value} value={value}>
                Clase {value}
              </option>
            ))}
          </select>
        </label>
        <h3 className="events-form-full">Seguridad social y pago</h3>
        <label className="field">
          EPS
          <input value={form.healthFund} onChange={set("healthFund")} required maxLength={80} />
        </label>
        <label className="field">
          Fondo de pensiones
          <input value={form.pensionFund} onChange={set("pensionFund")} required maxLength={80} />
        </label>
        <label className="field">
          Fondo de cesantías (opcional)
          <input value={form.severanceFund} onChange={set("severanceFund")} maxLength={80} />
        </label>
        <label className="field">
          Banco (opcional)
          <input value={form.bankName} onChange={set("bankName")} maxLength={80} />
        </label>
        <label className="field">
          Número de cuenta (opcional)
          <input value={form.bankAccount} onChange={set("bankAccount")} maxLength={40} />
        </label>
        {state.error && (
          <p className="report-error events-form-full" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-dialog-actions events-form-full">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={state.busy}>
            {state.busy ? "Guardando…" : employee ? "Guardar cambios" : "Crear empleado"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Nómina electrónica ──────────────────────────────────────────────────────

type ElectronicRow = {
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    identificationType: string;
    identificationNumber: string;
  };
  earnings: string;
  deductions: string;
  netPay: string;
  runs: number;
  document: { number: string; dianStatus: string; netPay: string; outdated: boolean; updatedAt: string } | null;
};
const dianLabels: Record<string, string> = {
  PENDING: "Pendiente",
  QUEUED: "En cola DIAN",
  SENT: "Enviado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado",
};

function ElectronicPayroll() {
  const today = defaultPeriod().to;
  const [period, setPeriod] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const report = useReport<{ data: ElectronicRow[] }>("/v1/payroll/electronic", period);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const rows = report.data?.data ?? [];
  const transmit = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiPost<{ data: { sent: number; skipped: number } }>(
        `/v1/payroll/electronic/${period.year}/${period.month}/transmit`
      );
      setNotice({
        kind: "ok",
        text: `Se enviaron ${result.data.sent} documento(s)${result.data.skipped ? ` y ${result.data.skipped} ya aceptado(s) se dejaron igual` : ""}.`,
      });
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel collections">
      <div className="events-info costing-info payroll-info" role="note">
        <span className="events-info-icon" aria-hidden="true">
          i
        </span>
        <p>
          El documento soporte de pago de nómina electrónica se envía a la DIAN <b>una vez al mes por empleado</b>, con
          lo devengado y deducido en las liquidaciones aprobadas o pagadas que terminan en ese mes. Con el proveedor
          DIAN de pruebas los documentos quedan <b>En cola DIAN</b> y no se transmiten.
        </p>
      </div>
      <div className="quotes-toolbar">
        <label className="field costing-year">
          Mes
          <select value={period.month} onChange={event => setPeriod({ ...period, month: Number(event.target.value) })}>
            {monthNames.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field payroll-year">
          Año
          <input
            type="number"
            min={2000}
            max={2100}
            value={period.year}
            onChange={event => setPeriod({ ...period, year: Number(event.target.value) })}
          />
        </label>
        <span className="collections-spacer" />
        <button type="button" className="primary" onClick={transmit} disabled={busy || !rows.length}>
          {busy ? "Enviando…" : "Generar y enviar a la DIAN"}
        </button>
      </div>
      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={report.loading && !report.data} error={report.error} />
      {report.data && (
        <div className="report-table-wrap">
          <table className="report-table collections-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th className="num">Liquidaciones</th>
                <th className="num">Devengado</th>
                <th className="num">Deducciones</th>
                <th className="num">Neto</th>
                <th>Documento</th>
                <th>Estado DIAN</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.employee.id}>
                  <td>
                    {row.employee.lastName} {row.employee.firstName}
                    <small>
                      {row.employee.identificationType} {row.employee.identificationNumber}
                    </small>
                  </td>
                  <td className="num">{row.runs}</td>
                  <td className="num">{money(row.earnings)}</td>
                  <td className="num">{money(row.deductions)}</td>
                  <td className="num">{money(row.netPay)}</td>
                  <td>{row.document?.number ?? "—"}</td>
                  <td>
                    {row.document ? (
                      <>
                        <span
                          className={
                            row.document.dianStatus === "ACCEPTED"
                              ? "pay-badge is-ok"
                              : row.document.dianStatus === "REJECTED"
                                ? "pay-badge is-bad"
                                : "pay-badge is-pending"
                          }
                        >
                          {dianLabels[row.document.dianStatus] ?? row.document.dianStatus}
                        </span>
                        {row.document.outdated && (
                          <small className="receipt-overdue">Cambió después del envío: vuelve a enviar</small>
                        )}
                      </>
                    ) : (
                      <span className="pay-badge">Sin enviar</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="report-message">
              No hay liquidaciones aprobadas o pagadas que terminen en {monthNames[period.month - 1].toLowerCase()} de{" "}
              {period.year}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Parámetros ──────────────────────────────────────────────────────────────

type SettingsResponse = {
  data: {
    year: number;
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
    confirmed: boolean;
    confirmedAt?: string | null;
    saved: boolean;
    basedOn: number | null;
  };
};
const settingFields: [keyof SettingsResponse["data"], string, string][] = [
  ["minimumWage", "Salario mínimo mensual (SMMLV)", "$"],
  ["transportAllowance", "Auxilio de transporte mensual", "$"],
  ["monthlyHours", "Horas mensuales (jornada legal)", "h"],
  ["overtimeDayPct", "Hora extra diurna", "%"],
  ["overtimeNightPct", "Hora extra nocturna", "%"],
  ["nightSurchargePct", "Recargo nocturno", "%"],
  ["holidaySurchargePct", "Recargo dominical y festivo", "%"],
  ["healthEmployeePct", "Salud — empleado", "%"],
  ["pensionEmployeePct", "Pensión — empleado", "%"],
  ["healthEmployerPct", "Salud — empleador", "%"],
  ["pensionEmployerPct", "Pensión — empleador", "%"],
  ["compensationFundPct", "Caja de compensación", "%"],
  ["icbfPct", "ICBF", "%"],
  ["senaPct", "SENA", "%"],
];

function PayrollSettingsForm() {
  const currentYear = Number(defaultPeriod().to.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const report = useReport<SettingsResponse>(`/v1/payroll/settings/${year}`);
  const data = report.data?.data;
  return (
    <section className="panel collections">
      <div className="quotes-toolbar">
        <label className="field costing-year">
          Año
          <select value={year} onChange={event => setYear(Number(event.target.value))}>
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ReportStatus loading={report.loading && !data} error={report.error} />
      {data && <SettingsEditor key={`${year}-${data.saved}-${data.confirmed}`} data={data} onSaved={report.reload} />}
    </section>
  );
}

function SettingsEditor({ data, onSaved }: { data: SettingsResponse["data"]; onSaved: () => void }) {
  const [form, setForm] = useState(
    () => Object.fromEntries(settingFields.map(([key]) => [key, String(data[key])])) as Record<string, string>
  );
  const [exempt, setExempt] = useState(data.exempt);
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });
  const save = async (confirmed: boolean) => {
    setState({ busy: true });
    try {
      await apiPut(`/v1/payroll/settings/${data.year}`, {
        ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, Number(value)])),
        exempt,
        confirmed,
      });
      setState({
        busy: false,
        ok: confirmed
          ? `Parámetros de ${data.year} confirmados: ya puedes liquidar.`
          : "Parámetros guardados sin confirmar.",
      });
      onSaved();
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <form
      className="payroll-settings"
      onSubmit={event => {
        event.preventDefault();
        save(true);
      }}
    >
      {data.basedOn ? (
        <p className="collections-notice is-error" role="status">
          {data.year} aún no tiene parámetros: se proponen los de {data.basedOn}. Revísalos con los decretos de{" "}
          {data.year} (salario mínimo, auxilio de transporte, jornada y recargo dominical) antes de confirmarlos.
        </p>
      ) : data.confirmed ? (
        <p className="collections-notice" role="status">
          Parámetros de {data.year} confirmados
          {data.confirmedAt
            ? ` el ${new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short" }).format(new Date(data.confirmedAt))}`
            : ""}
          . Si los cambias, las liquidaciones en borrador se recalculan al aprobarlas; las aprobadas no cambian.
        </p>
      ) : (
        <p className="collections-notice is-error" role="status">
          Guardados sin confirmar: confírmalos para poder liquidar {data.year}.
        </p>
      )}
      <div className="payroll-settings-grid">
        {settingFields.map(([key, label, unit]) => (
          <label key={key} className="field">
            {label}
            <span className="payroll-unit">
              <input
                type="number"
                min="0"
                step={unit === "h" ? "1" : "0.01"}
                value={form[key]}
                onChange={event => setForm({ ...form, [key]: event.target.value })}
                required
              />
              <span>{unit}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="events-check">
        <input type="checkbox" checked={exempt} onChange={event => setExempt(event.target.checked)} />
        Empresa exonerada de salud, ICBF y SENA del empleador por los empleados que ganan menos de 10 SMMLV (art. 114-1
        E.T.)
      </label>
      <p className="report-hint">
        ARL por clase de riesgo (Decreto 1772 de 1994): I 0,522 % · II 1,044 % · III 2,436 % · IV 4,35 % · V 6,96 %.
      </p>
      {state.error && (
        <p className="report-error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="collections-notice" role="status">
          {state.ok}
        </p>
      )}
      <div className="report-actions">
        <button type="button" className="secondary" disabled={state.busy} onClick={() => save(false)}>
          Guardar sin confirmar
        </button>
        <button type="submit" className="primary" disabled={state.busy}>
          {state.busy ? "Guardando…" : "Confirmar parámetros"}
        </button>
      </div>
    </form>
  );
}
