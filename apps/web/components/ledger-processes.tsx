/**
 * Contabilidad › Más procesos: pantalla de procesos (6 grupos, como la referencia) y los procesos funcionales:
 * cierre de año, comprobantes favoritos, borrado masivo (anulación) de comprobantes y certificado de ingresos y
 * retenciones. Los saldos iniciales de otras cuentas usan ManualEntryForm (ledger-reports.tsx) con kind="OPENING".
 * API: apps/api/src/ledger.ts y /v1/payroll/certificates (payroll.ts). Ver docs/contabilidad.md.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { apiDelete, apiPost } from "../lib/api";
import { date, defaultPeriod, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { periodPresets, presetRange, type Preset } from "./billing-report-quotes";
import { Modal, VoidDocumentDialog } from "./collection-dialogs";
import { entryHref } from "./ledger-reports";

type ProcessItem = { label: string; href?: string; pending?: string };
const groups: { title: string; items: ProcessItem[] }[] = [
  {
    title: "Contables",
    items: [
      {
        label: "Diferencia en cambio",
        pending: "Betel aún no registra documentos en moneda extranjera: no hay saldos que reexpresar.",
      },
      { label: "Cierre de año", href: "/contabilidad/cierre-de-ano" },
      {
        label: "Cierre cuentas de impuestos y otras cuentas por tercero",
        pending: "Requiere el tercero en cada renglón contable, que Betel aún no guarda.",
      },
      {
        label: "Verifica y bloquea documentos",
        pending: "Bloqueo de documentos por período: pendiente (ningún módulo valida aún fechas cerradas).",
      },
      { label: "Copias de comprobantes favoritos", href: "/contabilidad/favoritos" },
      { label: "Borrado masivo de comprobantes", href: "/contabilidad/borrado-masivo" },
    ],
  },
  {
    title: "Medios Magnéticos",
    items: [
      {
        label: "Asistente de medios magnéticos",
        pending: "La información exógena se reporta por tercero: requiere el tercero en cada renglón contable.",
      },
      {
        label: "Informe auxiliar medios magnéticos distritales y/o municipales",
        pending: "Requiere el tercero en cada renglón y la retención de ICA, que Betel aún no calcula.",
      },
    ],
  },
  {
    title: "Activos fijos",
    items: [
      {
        label: "Creación de activo fijo",
        pending: "Registro de activos con vida útil y depreciación mensual: pendiente.",
      },
      { label: "Importar activo fijo", pending: "Depende de la creación de activos fijos." },
    ],
  },
  {
    title: "Certificados",
    items: [
      {
        label: "Generar certificado de retención a título de renta, IVA e ICA",
        pending: "Betel aún no calcula retenciones en compras y ventas.",
      },
      {
        label: "Generar certificado de ingresos y retenciones / Formulario 220",
        href: "/contabilidad/certificado-ingresos",
      },
    ],
  },
  {
    title: "Saldos Iniciales",
    items: [
      {
        label: "Saldos iniciales de cuentas por cobrar",
        pending: "Documentos de saldo inicial por cliente que entren a la cartera: pendiente.",
      },
      {
        label: "Saldos iniciales de cuentas por pagar",
        pending: "Documentos de saldo inicial por proveedor que entren a cuentas por pagar: pendiente.",
      },
      { label: "Saldos iniciales de inventario", href: "/productos/documentos/nuevo?tipo=INITIAL" },
    ],
  },
  {
    title: "Saldos iniciales otras cuentas",
    items: [{ label: "Saldos iniciales de otras cuentas contables", href: "/contabilidad/saldos-iniciales" }],
  },
];

export function ProcessGroups() {
  return (
    <div className="process-groups">
      {groups.map(group => (
        <section key={group.title} className="panel process-group">
          <h2>{group.title}</h2>
          <ul>
            {group.items.map(item => (
              <li key={item.label}>
                {item.href ? (
                  <Link href={item.href}>{item.label}</Link>
                ) : (
                  <span className="process-pending" title={item.pending}>
                    {item.label} <small>En desarrollo</small>
                    <em>{item.pending}</em>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const back = (
  <Link href="/contabilidad?tab=procesos" className="report-link">
    ‹ Volver a Más procesos
  </Link>
);

// ─── Cierre de año ───────────────────────────────────────────────────────────

type YearClose = {
  year: number;
  finished: boolean;
  accounts: { code: string; name: string; balance: string }[];
  income: string;
  expenses: string;
  result: string;
  closing: { id: string; status: string; postedAt: string | null; outdated: boolean } | null;
};

export function YearCloseView() {
  const { canReceive: canEdit } = useSession();
  const currentYear = Number(defaultPeriod().to.slice(0, 4));
  const [year, setYear] = useState(currentYear - 1);
  const report = useReport<{ data: YearClose }>("/v1/accounting/year-close", { year });
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const data = report.data?.data;
  const closed = data?.closing?.status === "POSTED";
  const close = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiPost<{ data: { result: string } }>("/v1/accounting/year-close", { year });
      setNotice({
        kind: "ok",
        text: `Año ${year} cerrado: ${Number(result.data.result) < 0 ? "pérdida" : "utilidad"} de ${money(Math.abs(Number(result.data.result)))}.`,
      });
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-content">
      <div className="document-toolbar">{back}</div>
      <section className="panel">
        <div className="banks-period">
          <label className="field">
            Año a cerrar
            <select value={year} onChange={event => setYear(Number(event.target.value))}>
              {Array.from({ length: 6 }, (_, index) => currentYear - index).map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="report-hint">
          El cierre lleva a cero las cuentas de ingresos, gastos y costos (clases 4 a 7) del año con un asiento al 31 de
          diciembre (CIERRE-{year}) y traslada el resultado a 360505 Utilidad del ejercicio o 361005 Pérdida del
          ejercicio.
        </p>
        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}
        <ReportStatus loading={report.loading && !data} error={report.error} />
        {data && (
          <>
            <div className="statement-kpis">
              <div>
                <span>Ingresos del año</span>
                <b>{money(data.income)}</b>
              </div>
              <div>
                <span>Gastos y costos</span>
                <b>{money(data.expenses)}</b>
              </div>
              <div className={Number(data.result) < 0 ? "is-bad" : undefined}>
                <span>{Number(data.result) < 0 ? "Pérdida del ejercicio" : "Utilidad del ejercicio"}</span>
                <b>{money(Math.abs(Number(data.result)))}</b>
              </div>
              <div>
                <span>Estado</span>
                <b>
                  {closed
                    ? data.closing!.outdated
                      ? "Desactualizado"
                      : "Cerrado"
                    : data.closing
                      ? "Cierre anulado"
                      : "Sin cerrar"}
                </b>
              </div>
            </div>
            {closed && data.closing!.outdated && (
              <p className="collections-notice is-error" role="status">
                Después del cierre se registraron ingresos, gastos o costos de {year}: el comprobante CIERRE-{year} ya
                no deja esas cuentas en cero. Anula el cierre y vuelve a cerrar el año.
              </p>
            )}
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th className="num">Saldo del año (débito + / crédito −)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map(account => (
                    <tr key={account.code}>
                      <td>
                        {account.code} · {account.name}
                      </td>
                      <td className="num">{money(account.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.accounts.length && <p className="report-message">No hay movimientos de resultado en {year}.</p>}
            </div>
            {canEdit && (
              <div className="report-actions year-close-actions">
                {closed ? (
                  <>
                    <Link href={entryHref(data.closing!.id)} className="secondary">
                      Ver comprobante CIERRE-{year}
                    </Link>
                    <button type="button" className="secondary danger" onClick={() => setVoiding(true)}>
                      Anular cierre
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    onClick={close}
                    disabled={busy || !data.finished || !data.accounts.length}
                    title={!data.finished ? "Solo se cierra un año ya terminado" : undefined}
                  >
                    {busy ? "Cerrando…" : `Cerrar el año ${year}`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
      {voiding && (
        <VoidDocumentDialog
          title={`Anular el cierre de ${year}`}
          description="El comprobante de cierre queda anulado y las cuentas de resultado vuelven a mostrar sus saldos del año."
          path={`/v1/accounting/year-close/${year}/void`}
          confirmLabel="Anular cierre"
          onClose={() => setVoiding(false)}
          onVoided={() => {
            setVoiding(false);
            setNotice({ kind: "ok", text: `Cierre de ${year} anulado.` });
            report.reload();
          }}
        />
      )}
    </div>
  );
}

// ─── Comprobantes favoritos ──────────────────────────────────────────────────

type Template = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  lines: {
    accountId: string;
    debit: number;
    credit: number;
    memo?: string;
    account: { code: string; name: string; active: boolean } | null;
  }[];
};

export function FavoriteEntries() {
  const { canReceive: canEdit } = useSession();
  const report = useReport<{ data: Template[] }>("/v1/accounting/templates");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const remove = async (template: Template) => {
    setNotice(null);
    try {
      await apiDelete(`/v1/accounting/templates/${template.id}`);
      setNotice({ kind: "ok", text: `Favorito “${template.name}” eliminado.` });
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };
  const rows = report.data?.data ?? [];
  return (
    <div className="page-content">
      <div className="document-toolbar">{back}</div>
      <section className="panel">
        <p className="report-hint">
          Guarda como favorito cualquier comprobante desde su detalle (botón “Guardar como favorito”) y úsalo para crear
          comprobantes manuales con las mismas cuentas y valores, que puedes cambiar antes de contabilizar.
        </p>
        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}
        <ReportStatus loading={report.loading && !report.data} error={report.error} />
        {report.data && (
          <div className="favorite-list">
            {rows.map(template => (
              <article key={template.id} className="favorite-card">
                <div>
                  <h3>{template.name}</h3>
                  <p>{template.description}</p>
                  <ul>
                    {template.lines.map((line, index) => (
                      <li key={index}>
                        {line.account ? `${line.account.code} · ${line.account.name}` : "Cuenta eliminada"}
                        {line.debit
                          ? ` — débito ${money(line.debit)}`
                          : line.credit
                            ? ` — crédito ${money(line.credit)}`
                            : " — valor por definir"}
                      </li>
                    ))}
                  </ul>
                </div>
                {canEdit && (
                  <div className="report-actions">
                    <Link href={`/contabilidad/comprobante/nuevo?plantilla=${template.id}`} className="primary">
                      Usar
                    </Link>
                    <button type="button" className="secondary danger" onClick={() => remove(template)}>
                      Eliminar
                    </button>
                  </div>
                )}
              </article>
            ))}
            {!rows.length && (
              <p className="report-message">
                Aún no hay favoritos. Abre un comprobante en el{" "}
                <Link href="/contabilidad/libro-diario">libro diario</Link> y usa “Guardar como favorito”.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Diálogo para guardar un comprobante como favorito (se usa en el detalle del comprobante). */
export function SaveFavoriteDialog({
  description,
  lines,
  onClose,
  onSaved,
}: {
  description: string;
  lines: { accountId: string; debit: string; credit: string; memo: string | null }[];
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      await apiPost("/v1/accounting/templates", {
        name: name.trim(),
        description: description.replace(/ — ANULADO:.*$/, "").slice(0, 300),
        lines: lines.map(line => ({
          accountId: line.accountId,
          debit: Number(line.debit),
          credit: Number(line.credit),
          memo: line.memo ?? undefined,
        })),
      });
      onSaved(name.trim());
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title="Guardar como favorito" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="report-dialog-text">Se guardan las cuentas, los valores y el detalle de cada renglón.</p>
        <label className="field">
          Nombre del favorito
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            minLength={3}
            maxLength={80}
            required
            autoFocus
            placeholder="Ej. Arriendo mensual"
          />
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
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Borrado masivo ──────────────────────────────────────────────────────────

type JournalRow = {
  id: string;
  reference: string;
  date: string;
  description: string;
  sourceLabel: string;
  status: string;
  total: string;
};

export function BulkVoid() {
  const { canReceive: canEdit } = useSession();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month", defaultPeriod()));
  const report = useReport<{ data: JournalRow[]; pagination: { total: number } }>("/v1/accounting/journal", {
    ...range,
    source: "MANUAL",
    pageSize: 100,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });
  const rows = (report.data?.data ?? []).filter(row => row.status === "POSTED");
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const result = await apiPost<{ data: { voided: number; skipped: number } }>("/v1/accounting/journal/bulk-void", {
        ids: [...selected],
        reason: reason.trim(),
      });
      setState({
        busy: false,
        ok: `Se anularon ${result.data.voided} comprobante(s)${result.data.skipped ? `; ${result.data.skipped} no se pudieron anular` : ""}.`,
      });
      setSelected(new Set());
      setReason("");
      report.reload();
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <div className="page-content">
      <div className="document-toolbar">{back}</div>
      <section className="panel">
        <p className="report-hint">
          Anula varios comprobantes manuales o de saldos iniciales a la vez. En Betel no se borran: quedan anulados
          (dejan de sumar) para conservar la trazabilidad. Los comprobantes automáticos se anulan desde su documento.
        </p>
        <div className="banks-period">
          <label className="field">
            Período
            <select
              value={preset}
              onChange={event => {
                const value = event.target.value as Preset;
                setPreset(value);
                if (value !== "custom") setRange(presetRange(value, range));
                setSelected(new Set());
              }}
            >
              {Object.entries(periodPresets).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {preset === "custom" && (
            <>
              <label className="field">
                Desde
                <input
                  type="date"
                  value={range.from}
                  max={range.to}
                  onChange={event => setRange({ ...range, from: event.target.value })}
                />
              </label>
              <label className="field">
                Hasta
                <input
                  type="date"
                  value={range.to}
                  min={range.from}
                  onChange={event => setRange({ ...range, to: event.target.value })}
                />
              </label>
            </>
          )}
        </div>
        {state.ok && (
          <p className="collections-notice" role="status">
            {state.ok}
          </p>
        )}
        <ReportStatus loading={report.loading && !report.data} error={report.error} />
        {report.data && (
          <form onSubmit={submit}>
            <div className="report-table-wrap">
              <table className="report-table collections-table">
                <thead>
                  <tr>
                    <th className="products-check">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todos"
                        checked={rows.length > 0 && rows.every(row => selected.has(row.id))}
                        onChange={event =>
                          setSelected(event.target.checked ? new Set(rows.map(row => row.id)) : new Set())
                        }
                      />
                    </th>
                    <th>Fecha</th>
                    <th>Comprobante</th>
                    <th>Tipo</th>
                    <th>Descripción</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id}>
                      <td className="products-check">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Seleccionar ${row.reference}`}
                        />
                      </td>
                      <td>{date(row.date)}</td>
                      <td>
                        <Link href={entryHref(row.id)} className="collections-doc">
                          {row.reference}
                        </Link>
                      </td>
                      <td>{row.sourceLabel}</td>
                      <td>{row.description}</td>
                      <td className="num">{money(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <p className="report-message">No hay comprobantes manuales vigentes en el período.</p>}
            </div>
            {canEdit && rows.length > 0 && (
              <div className="bulk-void">
                <label className="field">
                  Motivo de la anulación
                  <input
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                    minLength={3}
                    maxLength={300}
                    required
                  />
                </label>
                <button type="submit" className="primary danger" disabled={state.busy || !selected.size}>
                  {state.busy ? "Anulando…" : `Anular ${selected.size} seleccionado(s)`}
                </button>
              </div>
            )}
            {state.error && (
              <p className="report-error" role="alert">
                {state.error}
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}

// ─── Certificado de ingresos y retenciones ───────────────────────────────────

type CertificateRow = {
  employee: {
    id: string;
    identificationType: string;
    identificationNumber: string;
    firstName: string;
    lastName: string;
    position: string;
  };
  from: string;
  to: string;
  runs: number;
  salaries: number;
  transport: number;
  nonSalary: number;
  grossIncome: number;
  health: number;
  pension: number;
  withholding: number;
};
type CertificatesResponse = {
  data: CertificateRow[];
  year: number;
  organization: { legalName: string; nit: string; verificationDigit: string | null; address: string | null };
};

export function IncomeCertificates() {
  const { canReceive: allowed } = useSession();
  const currentYear = Number(defaultPeriod().to.slice(0, 4));
  const [year, setYear] = useState(currentYear - 1);
  const [employeeId, setEmployeeId] = useState("");
  const report = useReport<CertificatesResponse>(allowed ? "/v1/payroll/certificates" : null, { year });
  const rows = report.data?.data ?? [];
  const shown = employeeId ? rows.filter(row => row.employee.id === employeeId) : rows;
  return (
    <div className="page-content">
      <div className="document-toolbar no-print">
        {back}
        {shown.length > 0 && (
          <div className="page-actions">
            <button type="button" className="primary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
          </div>
        )}
      </div>
      {!allowed ? (
        <section className="panel report-unavailable">
          <h2>Sin acceso</h2>
          <p>El certificado usa datos de nómina: solo los roles Propietario, Administrador y Contador pueden verlo.</p>
        </section>
      ) : (
        <>
          <section className="panel no-print">
            <div className="banks-period">
              <label className="field">
                Año gravable
                <select
                  value={year}
                  onChange={event => {
                    setYear(Number(event.target.value));
                    setEmployeeId("");
                  }}
                >
                  {Array.from({ length: 5 }, (_, index) => currentYear - index).map(value => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Empleado
                <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
                  <option value="">Todos (uno por página)</option>
                  {rows.map(row => (
                    <option key={row.employee.id} value={row.employee.id}>
                      {row.employee.lastName} {row.employee.firstName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="report-hint">
              Basado en el formato 220 de la DIAN con los pagos de las liquidaciones de nómina aprobadas o pagadas del
              año. Verifica las casillas con la resolución vigente del año gravable antes de entregarlo; las
              prestaciones sociales pagadas (cesantías, prima) aún no se registran en Betel y no se incluyen.
            </p>
            <ReportStatus loading={report.loading && !report.data} error={report.error} />
            {report.data && !rows.length && (
              <p className="report-message">No hay liquidaciones aprobadas o pagadas en {year}.</p>
            )}
          </section>
          {report.data &&
            shown.map(row => (
              <article key={row.employee.id} className="panel document-sheet payroll-slip certificate-220">
                <header className="document-head">
                  <div>
                    <p className="eyebrow">Formato 220</p>
                    <h2>Certificado de ingresos y retenciones por rentas de trabajo y de pensiones</h2>
                    <p>
                      Año gravable {report.data!.year} · período {date(row.from)} – {date(row.to)}
                    </p>
                  </div>
                </header>
                <dl className="document-meta">
                  <div>
                    <dt>Retenedor</dt>
                    <dd>
                      {report.data!.organization.legalName} · NIT {report.data!.organization.nit}
                      {report.data!.organization.verificationDigit
                        ? `-${report.data!.organization.verificationDigit}`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Trabajador</dt>
                    <dd>
                      {row.employee.firstName} {row.employee.lastName} · {row.employee.identificationType}{" "}
                      {row.employee.identificationNumber}
                    </dd>
                  </div>
                </dl>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Concepto de los ingresos</th>
                      <th className="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Pagos por salarios (básico, horas extra, recargos y otros pagos salariales)</td>
                      <td className="num">{money(row.salaries)}</td>
                    </tr>
                    <tr>
                      <td>Auxilio de transporte</td>
                      <td className="num">{money(row.transport)}</td>
                    </tr>
                    <tr>
                      <td>Otros pagos laborales no salariales</td>
                      <td className="num">{money(row.nonSalary)}</td>
                    </tr>
                    <tr className="certificate-total">
                      <td>Total de ingresos brutos</td>
                      <td className="num">{money(row.grossIncome)}</td>
                    </tr>
                    <tr>
                      <td>Aportes obligatorios por salud a cargo del trabajador</td>
                      <td className="num">{money(row.health)}</td>
                    </tr>
                    <tr>
                      <td>Aportes obligatorios a fondos de pensiones y solidaridad pensional a cargo del trabajador</td>
                      <td className="num">{money(row.pension)}</td>
                    </tr>
                    <tr className="certificate-total">
                      <td>Valor de la retención en la fuente por rentas de trabajo</td>
                      <td className="num">{money(row.withholding)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="report-hint">{row.runs} liquidación(es) de nómina incluidas.</p>
              </article>
            ))}
        </>
      )}
    </div>
  );
}
