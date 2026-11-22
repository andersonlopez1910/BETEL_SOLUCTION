/**
 * Detalle de una liquidación de nómina (/nomina/liquidacion?id=…): empleados con devengado, deducciones, neto y costo
 * del empleador; novedades por empleado (en borrador), aprobar (contabiliza), pagar (caja o bancos), anular y
 * desprendibles. API: /v1/payroll/runs/:id (apps/api/src/payroll.ts).
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost, apiPut } from "../lib/api";
import { date, defaultPeriod, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { Modal, VoidDocumentDialog } from "./collection-dialogs";
import { frequencyLabels, runStatusBadges, runStatusLabels } from "./payroll";

export type Calculation = Record<string, number | boolean>;
export type RunItem = {
  id: string;
  employee: {
    id: string;
    identificationType: string;
    identificationNumber: string;
    firstName: string;
    lastName: string;
    position: string;
    salary: string;
    salaryType: string;
    riskClass: number;
    healthFund: string;
    pensionFund: string;
    bankName: string | null;
    bankAccount: string | null;
  };
  novelties: {
    days: number;
    overtimeDay: number;
    overtimeNight: number;
    nightHours: number;
    holidayHours: number;
    salaryBonus: number;
    nonSalaryBonus: number;
    withholding: number;
    otherDeductions: number;
    notes: string | null;
  };
  earnings: string;
  deductions: string;
  netPay: string;
  employerCost: string;
  calculation: Calculation;
};
export type RunDetail = {
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
  paidAt: string | null;
  paymentMethod: string | null;
  voidReason: string | null;
  organization: { legalName: string; nit: string };
  items: RunItem[];
};

export const slipHref = (runId: string, employeeId?: string) =>
  `/nomina/desprendible?run=${runId}${employeeId ? `&empleado=${employeeId}` : ""}`;

export function PayrollRunView() {
  const id = useSearchParams().get("id") ?? "";
  const { canReceive: allowed } = useSession();
  const report = useReport<{ data: RunDetail }>(`/v1/payroll/runs/${id}`);
  const [dialog, setDialog] = useState<{ kind: "item"; item: RunItem } | { kind: "pay" } | { kind: "void" } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const run = report.data?.data;
  const draft = run?.status === "DRAFT";

  const approve = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await apiPost(`/v1/payroll/runs/${id}/approve`);
      setNotice({ kind: "ok", text: "Liquidación aprobada y contabilizada." });
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/nomina" className="report-link">
          ‹ Volver a Nómina
        </Link>
        {run && allowed && (
          <div className="page-actions">
            {run.status !== "VOID" && run.status !== "DRAFT" && (
              <Link href={slipHref(run.id)} className="secondary">
                Desprendibles
              </Link>
            )}
            {(run.status === "DRAFT" || run.status === "APPROVED") && (
              <button type="button" className="secondary danger" onClick={() => setDialog({ kind: "void" })}>
                Anular
              </button>
            )}
            {draft && (
              <button type="button" className="primary" onClick={approve} disabled={busy}>
                {busy ? "Aprobando…" : "Aprobar y contabilizar"}
              </button>
            )}
            {run.status === "APPROVED" && (
              <button type="button" className="primary" onClick={() => setDialog({ kind: "pay" })}>
                Registrar pago
              </button>
            )}
          </div>
        )}
      </div>
      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={report.loading && !run} error={report.error} />
      {run && (
        <section className={`panel document-sheet${run.status === "VOID" ? " is-void" : ""}`}>
          <header className="document-head">
            <div>
              <p className="eyebrow">{run.organization.legalName}</p>
              <h2>Nómina {run.number}</h2>
              <p>
                {frequencyLabels[run.frequency]} · {date(run.periodStart)} – {date(run.periodEnd)}
                {run.paidAt && ` · pagada el ${date(run.paidAt)}`}
                {run.voidReason && ` · anulada: ${run.voidReason}`}
              </p>
            </div>
            <span className={runStatusBadges[run.status]}>{runStatusLabels[run.status]}</span>
          </header>
          <div className="statement-kpis">
            <div>
              <span>Devengado</span>
              <b>{money(run.totalEarnings)}</b>
            </div>
            <div>
              <span>Deducciones</span>
              <b>{money(run.totalDeductions)}</b>
            </div>
            <div>
              <span>Neto a pagar</span>
              <b>{money(run.netPay)}</b>
            </div>
            <div>
              <span>Aportes y provisiones del empleador</span>
              <b>{money(run.employerCost)}</b>
            </div>
          </div>
          {draft && (
            <p className="report-hint payroll-hint">
              En borrador: abre cada empleado para registrar días, horas extra, recargos, bonificaciones, retención y
              otros descuentos. Al aprobar se recalcula con los parámetros confirmados del año y se contabiliza.
            </p>
          )}
          <div className="report-table-wrap">
            <table className="report-table payroll-table">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th className="num">Días</th>
                  <th className="num">Básico</th>
                  <th className="num">Extras y recargos</th>
                  <th className="num">Auxilio transporte</th>
                  <th className="num">Devengado</th>
                  <th className="num">Deducciones</th>
                  <th className="num">Neto</th>
                  <th className="num">Costo empleador</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {run.items.map(item => (
                  <tr key={item.id}>
                    <td>
                      {item.employee.lastName} {item.employee.firstName}
                      <small>
                        {item.employee.position} · {money(item.employee.salary)}
                        {item.employee.salaryType === "INTEGRAL" && " (integral)"}
                      </small>
                    </td>
                    <td className="num">{item.novelties.days}</td>
                    <td className="num">{money(Number(item.calculation.basicPay))}</td>
                    <td className="num">{money(Number(item.calculation.overtimePay))}</td>
                    <td className="num">{money(Number(item.calculation.transport))}</td>
                    <td className="num">{money(item.earnings)}</td>
                    <td className="num">{money(item.deductions)}</td>
                    <td className="num">
                      <b>{money(item.netPay)}</b>
                    </td>
                    <td className="num">{money(item.employerCost)}</td>
                    <td>
                      {draft && allowed ? (
                        <button
                          type="button"
                          className="secondary payroll-edit"
                          onClick={() => setDialog({ kind: "item", item })}
                        >
                          Novedades
                        </button>
                      ) : (
                        run.status !== "VOID" && (
                          <Link href={slipHref(run.id, item.employee.id)} className="secondary payroll-edit">
                            Desprendible
                          </Link>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {run && dialog?.kind === "item" && (
        <ItemDialog
          runId={run.id}
          item={dialog.item}
          maxDays={run.frequency === "BIWEEKLY" ? 15 : 30}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setNotice({ kind: "ok", text: `Novedades de ${dialog.item.employee.firstName} guardadas y recalculadas.` });
            report.reload();
          }}
        />
      )}
      {run && dialog?.kind === "pay" && (
        <PayDialog
          run={run}
          onClose={() => setDialog(null)}
          onPaid={() => {
            setDialog(null);
            setNotice({ kind: "ok", text: "Pago registrado: aparece en Cajas y bancos." });
            report.reload();
          }}
        />
      )}
      {run && dialog?.kind === "void" && (
        <VoidDocumentDialog
          title={`Anular ${run.number}`}
          description={
            run.status === "APPROVED"
              ? "Se registra el asiento inverso de la causación. Esta acción no se puede deshacer."
              : "La liquidación en borrador queda anulada y se puede volver a liquidar el período."
          }
          path={`/v1/payroll/runs/${run.id}/void`}
          confirmLabel="Anular liquidación"
          onClose={() => setDialog(null)}
          onVoided={() => {
            setDialog(null);
            setNotice({ kind: "ok", text: `${run.number} anulada.` });
            report.reload();
          }}
        />
      )}
    </div>
  );
}

const noveltyFields: [keyof RunItem["novelties"], string, "hours" | "money"][] = [
  ["overtimeDay", "Horas extra diurnas", "hours"],
  ["overtimeNight", "Horas extra nocturnas", "hours"],
  ["nightHours", "Horas con recargo nocturno", "hours"],
  ["holidayHours", "Horas con recargo dominical o festivo", "hours"],
  ["salaryBonus", "Comisiones u otros pagos salariales", "money"],
  ["nonSalaryBonus", "Bonificaciones no salariales", "money"],
  ["withholding", "Retención en la fuente", "money"],
  ["otherDeductions", "Préstamos, libranzas y otros descuentos", "money"],
];

function ItemDialog({
  runId,
  item,
  maxDays,
  onClose,
  onSaved,
}: {
  runId: string;
  item: RunItem;
  maxDays: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const integral = item.employee.salaryType === "INTEGRAL";
  const [form, setForm] = useState(
    () =>
      ({
        days: String(item.novelties.days),
        ...Object.fromEntries(noveltyFields.map(([key]) => [key, String(item.novelties[key] ?? 0)])),
        notes: item.novelties.notes ?? "",
      }) as Record<string, string>
  );
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      await apiPut(`/v1/payroll/runs/${runId}/items/${item.id}`, {
        days: Number(form.days),
        ...Object.fromEntries(noveltyFields.map(([key]) => [key, Number(form[key] || 0)])),
        notes: form.notes || undefined,
      });
      onSaved();
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title={`Novedades de ${item.employee.firstName} ${item.employee.lastName}`} onClose={onClose} wide>
      <form onSubmit={submit} className="events-form">
        <label className="field">
          Días laborados (máx. {maxDays})
          <input
            type="number"
            min={0}
            max={maxDays}
            value={form.days}
            onChange={event => setForm({ ...form, days: event.target.value })}
            required
          />
        </label>
        <p className="report-dialog-text">
          Salario {money(item.employee.salary)}
          {integral ? " integral: ya incluye horas extra y recargos." : "."} Valor hora{" "}
          {money(Number(item.calculation.hourValue))}.
        </p>
        {noveltyFields.map(([key, label, kind]) => (
          <label key={key} className="field">
            {label}
            <input
              type="number"
              min="0"
              step={kind === "hours" ? "0.5" : "0.01"}
              value={form[key]}
              disabled={integral && kind === "hours"}
              onChange={event => setForm({ ...form, [key]: event.target.value })}
            />
          </label>
        ))}
        <label className="field events-form-full">
          Observaciones
          <input
            value={form.notes}
            onChange={event => setForm({ ...form, notes: event.target.value })}
            maxLength={300}
          />
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
            {state.busy ? "Calculando…" : "Guardar y recalcular"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PayDialog({ run, onClose, onPaid }: { run: RunDetail; onClose: () => void; onPaid: () => void }) {
  const today = defaultPeriod().to;
  const [form, setForm] = useState({ date: today, method: "BANK_TRANSFER" });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      await apiPost(`/v1/payroll/runs/${run.id}/pay`, form);
      onPaid();
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title={`Pagar ${run.number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          Se registra el pago del neto ({money(run.netPay)}) a {run.items.length} empleado(s): Salarios por pagar
          (250505) contra caja o bancos. Los aportes a seguridad social se pagan aparte en la planilla PILA.
        </p>
        <label className="field">
          Fecha del pago
          <input
            type="date"
            value={form.date}
            max={today}
            onChange={event => setForm({ ...form, date: event.target.value })}
            required
          />
        </label>
        <label className="field">
          Medio de pago
          <select value={form.method} onChange={event => setForm({ ...form, method: event.target.value })}>
            <option value="BANK_TRANSFER">Transferencia</option>
            <option value="CASH">Efectivo</option>
            <option value="CHECK">Cheque</option>
            <option value="OTHER">Otro</option>
          </select>
        </label>
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
            {state.busy ? "Registrando…" : "Registrar pago"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
