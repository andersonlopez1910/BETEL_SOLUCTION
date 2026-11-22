/**
 * Pestaña "Seguimiento comercial" (GET /v1/reports/billing/commercial-tasks).
 *
 * Criterios de búsqueda como la referencia (estado, fechas de creación, compromiso y modificación,
 * responsables, creado por, descripción, todos los contactos, avance, etapa, probabilidad, valor esperado,
 * compromiso, origen y tipo de empresa). El reporte se genera al pulsar "Buscar". Cada tarea se puede
 * editar, completar con su resultado o reabrir; "Nueva tarea comercial" la crea. Copiar, imprimir y
 * exportar trabajan sobre el resultado. Definiciones en apps/api/src/commercial.ts.
 */
"use client";

import { useEffect, useState } from "react";
import { apiPost } from "../lib/api";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { ActionMenu } from "./action-menu";
import {
  date,
  defaultPeriod,
  exportFromApi,
  money,
  ReportStatus,
  useReport,
  useSession,
} from "./billing-report-common";
import { periodPresets, presetRange, type Preset } from "./billing-report-quotes";
import { Modal } from "./collection-dialogs";

export const commitmentLabels: Record<string, string> = {
  CALL: "Llamada",
  MEETING: "Reunión",
  VISIT: "Visita",
  EMAIL: "Correo",
  SEND_QUOTE: "Enviar cotización",
  FOLLOW_UP: "Seguimiento",
  OTHER: "Otro",
};
export const stageLabels: Record<string, string> = {
  PROSPECT: "Prospecto",
  CONTACTED: "Contactado",
  PROPOSAL: "Propuesta enviada",
  NEGOTIATION: "Negociación",
  WON: "Ganada",
  LOST: "Perdida",
};
export const progressLabels: Record<string, string> = {
  NONE: "Sin avance",
  INITIAL: "Inicial",
  INTERMEDIATE: "Intermedio",
  ADVANCED: "Avanzado",
  CLOSED: "Cerrado",
};
export const originLabels: Record<string, string> = {
  REFERRAL: "Referido",
  WEBSITE: "Sitio web",
  SOCIAL: "Redes sociales",
  CALL: "Llamada",
  EVENT: "Evento",
  CUSTOMER: "Cliente actual",
  OTHER: "Otro",
};
export const companyLabels: Record<string, string> = {
  MICRO: "Micro",
  SMALL: "Pequeña",
  MEDIUM: "Mediana",
  LARGE: "Grande",
};
const probabilityLabels: Record<string, string> = {
  "0-25": "0 % a 25 %",
  "26-50": "26 % a 50 %",
  "51-75": "51 % a 75 %",
  "76-100": "76 % a 100 %",
};
const statusLabels: Record<string, string> = { PENDING: "Pendientes", COMPLETED: "Completadas", ALL: "Todas" };

type User = { id: string; displayName: string };
type Task = {
  id: string;
  number: string;
  party: {
    id: string;
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
    phone: string | null;
    active: boolean;
  };
  description: string;
  commitment: string;
  dueDate: string | null;
  overdue: boolean;
  stage: string;
  progress: string;
  probability: number;
  expectedValue: string | null;
  origin: string | null;
  companyType: string | null;
  status: "PENDING" | "COMPLETED";
  result: string | null;
  responsible: User;
  createdBy: User | null;
  createdAt: string;
  updatedAt: string;
};
type TasksResponse = {
  data: Task[];
  pagination: { page: number; pageSize: number; total: number };
  summary: { expectedValue: string };
};

type Criteria = {
  status: string;
  createdPreset: Preset;
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
  dueFrom: string;
  dueTo: string;
  responsibleIds: string[];
  createdById: string;
  description: string;
  allContacts: boolean;
  progress: string;
  stage: string;
  probability: string;
  minExpectedValue: string;
  commitment: string;
  origin: string;
  companyType: string;
};
const emptyCriteria = (responsibleIds: string[] = []): Criteria => ({
  status: "PENDING",
  createdPreset: "month",
  ...(() => {
    const { from, to } = defaultPeriod();
    return { createdFrom: from, createdTo: to };
  })(),
  updatedFrom: "",
  updatedTo: "",
  dueFrom: "",
  dueTo: "",
  responsibleIds,
  createdById: "",
  description: "",
  allContacts: false,
  progress: "",
  stage: "",
  probability: "",
  minExpectedValue: "",
  commitment: "",
  origin: "",
  companyType: "",
});

/** Criterios → parámetros de la API (vacíos se omiten). */
function toParams(criteria: Criteria) {
  const created =
    criteria.createdPreset === "all"
      ? { from: "", to: "" }
      : presetRange(criteria.createdPreset, { from: criteria.createdFrom, to: criteria.createdTo });
  return {
    status: criteria.status,
    createdFrom: created.from,
    createdTo: created.to,
    updatedFrom: criteria.updatedFrom,
    updatedTo: criteria.updatedTo,
    dueFrom: criteria.dueFrom,
    dueTo: criteria.dueTo,
    responsibleIds: criteria.responsibleIds.join(","),
    createdById: criteria.createdById,
    description: criteria.description.trim(),
    allContacts: String(criteria.allContacts),
    progress: criteria.progress,
    stage: criteria.stage,
    probability: criteria.probability,
    minExpectedValue: criteria.minExpectedValue,
    commitment: criteria.commitment,
    origin: criteria.origin,
    companyType: criteria.companyType,
  };
}

const columns: ReportColumn<Task>[] = [
  { header: "N.º", value: task => task.number },
  { header: "Contacto", value: task => task.party.legalName },
  { header: "Identificación", value: task => `${task.party.identificationType} ${task.party.identificationNumber}` },
  { header: "Descripción", value: task => task.description },
  { header: "Compromiso", value: task => commitmentLabels[task.commitment] },
  { header: "Fecha compromiso", value: task => (task.dueDate ? date(task.dueDate) : "") },
  { header: "Responsable", value: task => task.responsible.displayName },
  { header: "Etapa", value: task => stageLabels[task.stage] },
  { header: "Avance", value: task => progressLabels[task.progress] },
  { header: "Probabilidad", value: task => `${task.probability} %` },
  { header: "Valor esperado", value: task => task.expectedValue, money: true },
  { header: "Origen", value: task => (task.origin ? originLabels[task.origin] : "") },
  { header: "Tipo empresa", value: task => (task.companyType ? companyLabels[task.companyType] : "") },
  {
    header: "Estado",
    value: task => (task.status === "PENDING" ? (task.overdue ? "Vencida" : "Pendiente") : "Completada"),
  },
  { header: "Resultado", value: task => task.result ?? "" },
  { header: "Creado por", value: task => task.createdBy?.displayName ?? "" },
];

export function CommercialReport() {
  const { company, canExport, canEmail: canEdit } = useSession();
  const me = useReport<{ user: { id: string } }>("/v1/me");
  const users = useReport<{ data: User[] }>("/v1/reports/billing/users");
  const [criteria, setCriteria] = useState<Criteria>(emptyCriteria);
  const [applied, setApplied] = useState<Criteria | null>(null);
  const [showCriteria, setShowCriteria] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "task"; task: Task | null } | { kind: "complete"; task: Task } | null>(
    null
  );
  const report = useReport<TasksResponse>(applied ? "/v1/reports/billing/commercial-tasks" : null, {
    ...(applied ? toParams(applied) : {}),
    page,
    pageSize,
  });
  const data = applied ? report.data : undefined;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;

  // Como en la referencia, el responsable por defecto es el usuario de la sesión.
  const myId = me.data?.user.id;
  useEffect(() => {
    if (myId)
      setCriteria(current => (current.responsibleIds.length ? current : { ...current, responsibleIds: [myId] }));
  }, [myId]);

  const set = <K extends keyof Criteria>(field: K, value: Criteria[K]) => setCriteria({ ...criteria, [field]: value });
  const input = (field: keyof Criteria) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    set(field, event.target.value as never);
  const search = () => {
    setNotice(null);
    setApplied(criteria);
    setPage(1);
  };
  const clear = () => {
    setCriteria(emptyCriteria(myId ? [myId] : []));
    setApplied(null);
  };
  const userName = (id: string) => users.data?.data.find(user => user.id === id)?.displayName ?? "Usuario";

  const run = async (action: () => Promise<unknown>, done: string) => {
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "ok", text: done });
      if (applied) report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  const copy = async () => {
    const lines = [
      columns.map(column => column.header),
      ...rows.map(row => columns.map(column => String(column.value(row) ?? ""))),
    ];
    try {
      await navigator.clipboard.writeText(lines.map(line => line.join("\t")).join("\n"));
      setNotice({ kind: "ok", text: `${rows.length} tareas copiadas (se pegan en Excel u hojas de cálculo).` });
    } catch {
      setNotice({ kind: "error", text: "El navegador no permitió copiar al portapapeles." });
    }
  };
  const exportTasks = async (format: ExportFormat) => {
    if (!applied) return;
    setNotice(null);
    try {
      await exportFromApi<Task>(format, "/v1/reports/billing/commercial-tasks/export", toParams(applied), response => ({
        company,
        title: "Reporte de facturación — Seguimiento comercial",
        period: { from: toParams(applied).createdFrom || null, to: toParams(applied).createdTo || null },
        filters: [
          ["Estado tarea", statusLabels[applied.status]!],
          ...(applied.responsibleIds.length
            ? [["Responsables", applied.responsibleIds.map(userName).join(", ")] as [string, string]]
            : []),
        ],
        columns,
        rows: response.data,
        totals: [
          ["Tareas", String(response.data.length)],
          ["Valor esperado", money((response.summary as TasksResponse["summary"]).expectedValue)],
        ],
        fileName: "seguimiento-comercial",
      }));
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  const select = (field: keyof Criteria, options: Record<string, string>, label: string) => (
    <label className="crm-row">
      <span>{label}</span>
      <select value={criteria[field] as string} onChange={input(field)}>
        <option value="">Todos</option>
        {Object.entries(options).map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  const range = (label: string, from: keyof Criteria, to: keyof Criteria) => (
    <div className="crm-row">
      <span>{label}</span>
      <div className="crm-range">
        <input type="date" aria-label={`${label}: desde`} value={criteria[from] as string} onChange={input(from)} />
        <input
          type="date"
          aria-label={`${label}: hasta`}
          value={criteria[to] as string}
          min={criteria[from] as string}
          onChange={input(to)}
        />
      </div>
    </div>
  );

  return (
    <>
      <section className="panel collections crm">
        <div className="crm-head">
          <h2>Seguimiento comercial</h2>
          <div className="crm-tools">
            <button
              type="button"
              className="secondary crm-icon"
              onClick={copy}
              disabled={!rows.length}
              title="Copiar resultado"
            >
              ⧉ Copiar
            </button>
            <button
              type="button"
              className="secondary crm-icon"
              onClick={() => window.print()}
              disabled={!rows.length}
              title="Imprimir resultado"
            >
              ⎙ Imprimir
            </button>
            <ActionMenu
              label="Exportar"
              className="secondary crm-icon"
              items={(["pdf", "xlsx", "csv"] as const).map(format => ({
                label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
                onSelect: () => exportTasks(format),
                disabled: !canExport || !applied || !total,
                note: !canExport
                  ? "Tu rol no permite exportar"
                  : !applied
                    ? "Primero busca"
                    : !total
                      ? "Sin resultados"
                      : undefined,
              }))}
            >
              ⇪ Exportar
            </ActionMenu>
            <button
              type="button"
              className="primary"
              disabled={!canEdit}
              onClick={() => setDialog({ kind: "task", task: null })}
            >
              Nueva tarea comercial
            </button>
          </div>
        </div>

        <button
          type="button"
          className="report-link crm-toggle"
          aria-expanded={showCriteria}
          aria-controls="crm-criteria"
          onClick={() => setShowCriteria(!showCriteria)}
        >
          {showCriteria ? "⌃ Ocultar criterios de búsqueda" : "⌄ Ver criterios de búsqueda"}
        </button>

        {showCriteria && (
          <form
            id="crm-criteria"
            className="crm-criteria"
            onSubmit={event => {
              event.preventDefault();
              search();
            }}
          >
            <div className="crm-grid">
              <div>
                <label className="crm-row">
                  <span>Estado tarea</span>
                  <select value={criteria.status} onChange={input("status")}>
                    {Object.entries(statusLabels).map(([value, name]) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="crm-row">
                  <span>Fecha creación</span>
                  <div className="crm-range">
                    <select
                      aria-label="Período de creación"
                      value={criteria.createdPreset}
                      onChange={input("createdPreset")}
                    >
                      {Object.entries(periodPresets).map(([value, name]) => (
                        <option key={value} value={value}>
                          {value === "custom" ? "Rango" : name}
                        </option>
                      ))}
                    </select>
                    {criteria.createdPreset === "custom" && (
                      <>
                        <input
                          type="date"
                          aria-label="Creación desde"
                          value={criteria.createdFrom}
                          onChange={input("createdFrom")}
                        />
                        <input
                          type="date"
                          aria-label="Creación hasta"
                          value={criteria.createdTo}
                          min={criteria.createdFrom}
                          onChange={input("createdTo")}
                        />
                      </>
                    )}
                  </div>
                </div>
                <div className="crm-row">
                  <span>Usuario responsable</span>
                  <div className="crm-users">
                    {criteria.responsibleIds.map(id => (
                      <span key={id} className="mass-chip">
                        {userName(id)}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Quitar ${userName(id)}`}
                          onClick={() =>
                            set(
                              "responsibleIds",
                              criteria.responsibleIds.filter(item => item !== id)
                            )
                          }
                          onKeyDown={event => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              set(
                                "responsibleIds",
                                criteria.responsibleIds.filter(item => item !== id)
                              );
                            }
                          }}
                        >
                          ×
                        </span>
                      </span>
                    ))}
                    <select
                      aria-label="Agregar responsable"
                      value=""
                      onChange={event =>
                        event.target.value && set("responsibleIds", [...criteria.responsibleIds, event.target.value])
                      }
                    >
                      <option value="">{criteria.responsibleIds.length ? "Agregar…" : "Todos (agregar…)"}</option>
                      {users.data?.data
                        .filter(user => !criteria.responsibleIds.includes(user.id))
                        .map(user => (
                          <option key={user.id} value={user.id}>
                            {user.displayName}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                {range("Fecha compromiso", "dueFrom", "dueTo")}
                {select("progress", progressLabels, "Avance negociación")}
                {select("stage", stageLabels, "Etapa")}
                {select("probability", probabilityLabels, "Probabilidad cierre")}
                <label className="crm-row">
                  <span>Valor esperado desde</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={criteria.minExpectedValue}
                    onChange={input("minExpectedValue")}
                    placeholder="$ 0"
                  />
                </label>
              </div>
              <div>
                <label className="crm-row">
                  <span>Creado por</span>
                  <select value={criteria.createdById} onChange={input("createdById")}>
                    <option value="">Todos</option>
                    {users.data?.data.map(user => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                {range("Fecha modificación", "updatedFrom", "updatedTo")}
                <label className="crm-row">
                  <span>Descripción</span>
                  <input
                    value={criteria.description}
                    onChange={input("description")}
                    placeholder="Contiene…"
                    title="Busca las tareas cuya descripción contenga este texto"
                  />
                </label>
                <label className="crm-row crm-check">
                  <span>Todos los contactos</span>
                  <input
                    type="checkbox"
                    checked={criteria.allContacts}
                    onChange={event => set("allContacts", event.target.checked)}
                  />
                  <small>Incluye contactos inactivos</small>
                </label>
                {select("commitment", commitmentLabels, "Compromiso")}
                {select("origin", originLabels, "Origen")}
                {select("companyType", companyLabels, "Tipo empresa")}
              </div>
            </div>
            <div className="crm-actions">
              <button type="submit" className="primary">
                Buscar
              </button>
              <button type="button" className="report-link" onClick={clear}>
                Limpiar filtros
              </button>
            </div>
          </form>
        )}

        <div className="crm-count">
          <span>Encontrados ({applied ? total : 0})</span>
          <label>
            Registros por página
            <select
              value={pageSize}
              onChange={event => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 50, 100].map(size => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          {data && (
            <span>
              Valor esperado: <b>{money(data.summary.expectedValue)}</b>
            </span>
          )}
        </div>

        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}
        {!applied && (
          <p className="crm-placeholder">
            Seleccione el botón &quot;Buscar&quot; para realizar la búsqueda y generar el reporte.
          </p>
        )}
        {applied && (
          <ReportStatus loading={report.loading && !data} error={report.error} empty={!!data && !rows.length} />
        )}

        {data && rows.length > 0 && (
          <>
            <div className="report-table-wrap">
              <table className="report-table collections-table crm-table">
                <thead>
                  <tr>
                    <th>N.º</th>
                    <th>Contacto</th>
                    <th>Descripción</th>
                    <th>Compromiso</th>
                    <th>Fecha compromiso</th>
                    <th>Responsable</th>
                    <th>Etapa</th>
                    <th>Avance</th>
                    <th className="num">Prob.</th>
                    <th className="num">Valor esperado</th>
                    <th>Estado</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(task => (
                    <tr key={task.id} className={task.status === "COMPLETED" ? "is-cancelled" : undefined}>
                      <td>{task.number}</td>
                      <td>
                        <span className="collections-doc">{task.party.legalName}</span>
                        <small>
                          {task.party.identificationNumber}
                          {!task.party.active && " · Inactivo"}
                        </small>
                      </td>
                      <td className="crm-description">
                        {task.description}
                        {task.result && <small>Resultado: {task.result}</small>}
                      </td>
                      <td>{commitmentLabels[task.commitment]}</td>
                      <td>{task.dueDate ? date(task.dueDate) : "—"}</td>
                      <td>{task.responsible.displayName}</td>
                      <td>{stageLabels[task.stage]}</td>
                      <td>{progressLabels[task.progress]}</td>
                      <td className="num">{task.probability} %</td>
                      <td className="num">{task.expectedValue ? money(task.expectedValue) : "—"}</td>
                      <td>
                        <span
                          className={
                            task.status === "COMPLETED"
                              ? "pay-badge is-ok"
                              : task.overdue
                                ? "pay-badge is-bad"
                                : "pay-badge is-pending"
                          }
                        >
                          {task.status === "COMPLETED" ? "Completada" : task.overdue ? "Vencida" : "Pendiente"}
                        </span>
                      </td>
                      <td>
                        <ActionMenu
                          label={`Acciones de ${task.number}`}
                          className="secondary quotes-row-menu"
                          items={
                            task.status === "PENDING"
                              ? [
                                  {
                                    label: "Editar",
                                    onSelect: () => setDialog({ kind: "task", task }),
                                    disabled: !canEdit,
                                  },
                                  {
                                    label: "Completar",
                                    onSelect: () => setDialog({ kind: "complete", task }),
                                    disabled: !canEdit,
                                  },
                                ]
                              : [
                                  {
                                    label: "Reabrir",
                                    disabled: !canEdit,
                                    onSelect: () =>
                                      run(
                                        () => apiPost(`/v1/commercial-tasks/${task.id}/reopen`),
                                        `${task.number} vuelve a pendiente.`
                                      ),
                                  },
                                ]
                          }
                        >
                          ⋯
                        </ActionMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pay-pagination">
              <span>
                {(page - 1) * pageSize + 1} a {Math.min(page * pageSize, total)} de {total}
              </span>
              <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              <button
                type="button"
                aria-label="Página siguiente"
                disabled={page * pageSize >= total}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
            </div>
          </>
        )}
      </section>

      {dialog?.kind === "task" && (
        <TaskDialog
          task={dialog.task}
          users={users.data?.data ?? []}
          defaultResponsible={myId ?? ""}
          onClose={() => setDialog(null)}
          onSaved={number => {
            setDialog(null);
            setNotice({
              kind: "ok",
              text: dialog.task ? `${dialog.task.number} actualizada.` : `Tarea ${number} creada.`,
            });
            if (applied) report.reload();
            else search();
          }}
        />
      )}
      {dialog?.kind === "complete" && (
        <CompleteDialog
          task={dialog.task}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setNotice({ kind: "ok", text: `${dialog.task.number} completada.` });
            report.reload();
          }}
        />
      )}
    </>
  );
}

type Contact = {
  id: string;
  legalName: string;
  identificationType: string;
  identificationNumber: string;
  isCustomer: boolean;
};

/** Crear o editar una tarea comercial. */
function TaskDialog({
  task,
  users,
  defaultResponsible,
  onClose,
  onSaved,
}: {
  task: Task | null;
  users: User[];
  defaultResponsible: string;
  onClose: () => void;
  onSaved: (number: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const contacts = useReport<{ data: Contact[] }>("/v1/commercial/contacts", { search: query });
  const [form, setForm] = useState({
    partyId: task?.party.id ?? "",
    description: task?.description ?? "",
    commitment: task?.commitment ?? "CALL",
    dueDate: task?.dueDate ?? "",
    responsibleId: task?.responsible.id ?? defaultResponsible,
    stage: task?.stage ?? "PROSPECT",
    progress: task?.progress ?? "NONE",
    probability: String(task?.probability ?? 0),
    expectedValue: task?.expectedValue ? String(Number(task.expectedValue)) : "",
    origin: task?.origin ?? "",
    companyType: task?.companyType ?? "",
  });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const set =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [field]: event.target.value });
  const options = (labels: Record<string, string>, empty?: string) => (
    <>
      {empty !== undefined && <option value="">{empty}</option>}
      {Object.entries(labels).map(([value, name]) => (
        <option key={value} value={value}>
          {name}
        </option>
      ))}
    </>
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const body = {
        ...form,
        probability: Number(form.probability),
        ...(form.origin ? {} : { origin: undefined }),
        ...(form.companyType ? {} : { companyType: undefined }),
      };
      const result = await apiPost<{ data: { number?: string } }>(
        task ? `/v1/commercial-tasks/${task.id}` : "/v1/commercial-tasks",
        body
      );
      onSaved(result.data.number ?? task?.number ?? "");
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  return (
    <Modal title={task ? `Editar ${task.number}` : "Nueva tarea comercial"} onClose={onClose} wide>
      <form onSubmit={submit} className="customer-form crm-form">
        <div className="field">
          Contacto
          <div className="pay-invoice-search">
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setQuery(search);
                }
              }}
              placeholder="Buscar cliente o prospecto"
              aria-label="Buscar contacto"
            />
            <button type="button" className="secondary" onClick={() => setQuery(search)}>
              Buscar
            </button>
          </div>
          <select value={form.partyId} onChange={set("partyId")} required aria-label="Contacto">
            <option value="">{contacts.loading ? "Cargando…" : "Selecciona un contacto"}</option>
            {task && !contacts.data?.data.some(contact => contact.id === task.party.id) && (
              <option value={task.party.id}>{task.party.legalName}</option>
            )}
            {contacts.data?.data.map(contact => (
              <option key={contact.id} value={contact.id}>
                {contact.legalName} · {contact.identificationNumber}
                {contact.isCustomer ? "" : " (prospecto)"}
              </option>
            ))}
          </select>
        </div>
        <label className="field">
          Descripción
          <textarea
            value={form.description}
            onChange={set("description")}
            minLength={3}
            maxLength={1000}
            rows={2}
            required
          />
        </label>
        <div className="customer-id">
          <label className="field">
            Compromiso
            <select value={form.commitment} onChange={set("commitment")}>
              {options(commitmentLabels)}
            </select>
          </label>
          <label className="field">
            Fecha compromiso
            <input type="date" value={form.dueDate} onChange={set("dueDate")} />
          </label>
          <label className="field">
            Responsable
            <select value={form.responsibleId} onChange={set("responsibleId")} required>
              <option value="">Selecciona</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="customer-id">
          <label className="field">
            Etapa
            <select value={form.stage} onChange={set("stage")}>
              {options(stageLabels)}
            </select>
          </label>
          <label className="field">
            Avance negociación
            <select value={form.progress} onChange={set("progress")}>
              {options(progressLabels)}
            </select>
          </label>
          <label className="field">
            Probabilidad (%)
            <input type="number" min="0" max="100" value={form.probability} onChange={set("probability")} required />
          </label>
        </div>
        <div className="customer-id">
          <label className="field">
            Valor esperado
            <input type="number" min="0" step="1000" value={form.expectedValue} onChange={set("expectedValue")} />
          </label>
          <label className="field">
            Origen
            <select value={form.origin} onChange={set("origin")}>
              {options(originLabels, "Sin definir")}
            </select>
          </label>
          <label className="field">
            Tipo empresa
            <select value={form.companyType} onChange={set("companyType")}>
              {options(companyLabels, "Sin definir")}
            </select>
          </label>
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
            {state.busy ? "Guardando…" : task ? "Guardar cambios" : "Crear tarea"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompleteDialog({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      await apiPost(`/v1/commercial-tasks/${task.id}/complete`, { result: result.trim() });
      onDone();
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title={`Completar ${task.number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          {task.party.legalName}: {task.description}
        </p>
        <label className="field">
          Resultado de la gestión
          <input value={result} onChange={event => setResult(event.target.value)} minLength={3} required autoFocus />
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
            {state.busy ? "Guardando…" : "Completar tarea"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
