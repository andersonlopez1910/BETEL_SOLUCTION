/**
 * Desprendibles de pago de nómina (/nomina/desprendible?run=…&empleado=…): uno por empleado (o todos los de la
 * liquidación, uno por página al imprimir) con devengados, deducciones, neto, aportes del empleador y provisiones.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { date, money, ReportStatus, useReport } from "./billing-report-common";
import { frequencyLabels, runHref } from "./payroll";
import type { RunDetail, RunItem } from "./payroll-run";

export function PayrollSlips() {
  const params = useSearchParams();
  const runId = params.get("run") ?? "";
  const employeeId = params.get("empleado");
  const report = useReport<{ data: RunDetail }>(`/v1/payroll/runs/${runId}`);
  const run = report.data?.data;
  const items = run ? run.items.filter(item => !employeeId || item.employee.id === employeeId) : [];
  return (
    <div className="page-content">
      <div className="document-toolbar no-print">
        <Link href={runHref(runId)} className="report-link">
          ‹ Volver a la liquidación
        </Link>
        {run && (
          <div className="page-actions">
            <button type="button" className="primary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
          </div>
        )}
      </div>
      <ReportStatus loading={report.loading && !run} error={report.error} />
      {run && run.status === "DRAFT" && (
        <p className="collections-notice is-error" role="status">
          Liquidación en borrador: los valores pueden cambiar hasta que se apruebe.
        </p>
      )}
      {run && items.map(item => <Slip key={item.id} run={run} item={item} />)}
      {run && !items.length && <p className="report-message">El empleado no está en esta liquidación.</p>}
    </div>
  );
}

function Slip({ run, item }: { run: RunDetail; item: RunItem }) {
  const c = item.calculation as Record<string, number>;
  const rows = (pairs: [string, number][]) => pairs.filter(([, value]) => value > 0);
  const earnings = rows([
    [`Salario básico (${item.novelties.days} días)`, c.basicPay!],
    [`Horas extra diurnas (${item.novelties.overtimeDay} h)`, c.overtimeDayPay!],
    [`Horas extra nocturnas (${item.novelties.overtimeNight} h)`, c.overtimeNightPay!],
    [`Recargo nocturno (${item.novelties.nightHours} h)`, c.nightSurchargePay!],
    [`Recargo dominical o festivo (${item.novelties.holidayHours} h)`, c.holidaySurchargePay!],
    ["Comisiones y otros pagos salariales", c.salaryBonus!],
    ["Auxilio de transporte", c.transport!],
    ["Bonificaciones no salariales", c.nonSalaryBonus!],
  ]);
  const deductions = rows([
    ["Salud", c.healthEmployee!],
    ["Pensión", c.pensionEmployee!],
    [`Fondo de Solidaridad Pensional (${c.solidarityPct!.toLocaleString("es-CO")} %)`, c.solidarity!],
    ["Retención en la fuente", c.withholding!],
    ["Préstamos y otros descuentos", c.otherDeductions!],
  ]);
  const employer = rows([
    ["Salud", c.healthEmployer!],
    ["Pensión", c.pensionEmployer!],
    [`ARL (clase ${item.employee.riskClass}, ${c.arlRate!.toLocaleString("es-CO")} %)`, c.arl!],
    ["Caja de compensación", c.compensation!],
    ["ICBF", c.icbf!],
    ["SENA", c.sena!],
    ["Cesantías", c.severance!],
    ["Intereses sobre cesantías", c.severanceInterest!],
    ["Prima de servicios", c.serviceBonus!],
    ["Vacaciones", c.vacation!],
  ]);
  return (
    <article className="panel document-sheet payroll-slip">
      <header className="document-head">
        <div>
          <p className="eyebrow">
            {run.organization.legalName} · NIT {run.organization.nit}
          </p>
          <h2>Comprobante de pago de nómina</h2>
          <p>
            {run.number} · {frequencyLabels[run.frequency]} · {date(run.periodStart)} – {date(run.periodEnd)}
          </p>
        </div>
        <div className="document-total">
          <span>Neto a pagar</span>
          <b>{money(item.netPay)}</b>
        </div>
      </header>
      <dl className="document-meta">
        <div>
          <dt>Empleado</dt>
          <dd>
            {item.employee.firstName} {item.employee.lastName} · {item.employee.identificationType}{" "}
            {item.employee.identificationNumber}
          </dd>
        </div>
        <div>
          <dt>Cargo y salario</dt>
          <dd>
            {item.employee.position} · {money(item.employee.salary)}
            {item.employee.salaryType === "INTEGRAL" && " (integral)"}
          </dd>
        </div>
        <div>
          <dt>Seguridad social</dt>
          <dd>
            Salud: {item.employee.healthFund} · Pensión: {item.employee.pensionFund} · IBC {money(c.ibc!)}
          </dd>
        </div>
        {item.employee.bankAccount && (
          <div>
            <dt>Cuenta de pago</dt>
            <dd>
              {item.employee.bankName ?? ""} {item.employee.bankAccount}
            </dd>
          </div>
        )}
      </dl>
      <div className="payroll-slip-columns">
        <SlipTable title="Devengados" rows={earnings} total={Number(item.earnings)} />
        <SlipTable title="Deducciones" rows={deductions} total={Number(item.deductions)} />
      </div>
      <SlipTable
        title="Aportes del empleador y provisiones (informativo)"
        rows={employer}
        total={Number(item.employerCost)}
      />
      {item.novelties.notes && <p className="report-dialog-text">Observaciones: {item.novelties.notes}</p>}
    </article>
  );
}

function SlipTable({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  return (
    <div className="payroll-slip-table">
      <h3>{title}</h3>
      <table className="report-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{money(value)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={2}>—</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            <th className="num">{money(total)}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
