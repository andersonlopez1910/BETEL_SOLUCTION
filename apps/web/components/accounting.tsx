/**
 * Módulo "Contabilidad" (/contabilidad): pestañas Cuentas contables (árbol PUC con búsqueda por código y nombre,
 * expandir todo, descarga en Excel y panel para ver, crear, editar o eliminar la cuenta elegida) y Más procesos
 * (balance de prueba, libro diario, comprobante contable manual y accesos a otros procesos contables).
 * API: apps/api/src/ledger.ts; estructura del PUC en apps/api/src/puc.ts. Ver docs/contabilidad.md.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { apiDelete, apiPost, apiPut } from "../lib/api";
import { exportReport, type ReportColumn } from "../lib/report-export";
import { money, ReportStatus, useReport, useSession } from "./billing-report-common";

const tabs = [
  ["cuentas", "Cuentas contables"],
  ["procesos", "Más procesos"],
] as const;

export function AccountingModule() {
  const requested = useSearchParams().get("tab");
  const [slug] = tabs.find(([tab]) => tab === requested) ?? tabs[0];
  return (
    <div className="page-content">
      <nav className="report-tabs" aria-label="Contabilidad">
        {tabs.map(([tab, name]) => (
          <Link
            key={tab}
            href={`/contabilidad?tab=${tab}`}
            scroll={false}
            aria-current={tab === slug ? "page" : undefined}
            className={tab === slug ? "active" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>
      {slug === "cuentas" ? <ChartOfAccounts /> : <MoreProcesses />}
    </div>
  );
}

type ChartNode = {
  code: string;
  name: string;
  id: string | null;
  level: "CLASS" | "GROUP" | "ACCOUNT" | "SUBACCOUNT" | "AUXILIARY";
  nature: "DEBIT" | "CREDIT";
  source: "PUC" | "ORG";
  active: boolean;
  system: boolean;
  hasChildren: boolean;
  postable: boolean;
  movements: number;
  debits: string;
  credits: string;
  balance: string;
};

const levelLabels: Record<ChartNode["level"], string> = {
  CLASS: "Clase",
  GROUP: "Grupo",
  ACCOUNT: "Cuenta",
  SUBACCOUNT: "Subcuenta",
  AUXILIARY: "Auxiliar",
};
const childLabel: Partial<Record<ChartNode["level"], string>> = {
  GROUP: "cuenta",
  ACCOUNT: "subcuenta",
  SUBACCOUNT: "auxiliar",
};
const parentOf = (code: string) => (code.length <= 1 ? null : code.length === 2 ? code.slice(0, 1) : code.slice(0, -2));
const depth = (code: string) => ({ 1: 0, 2: 1, 4: 2, 6: 3 })[code.length] ?? 4;

const exportColumns: ReportColumn<ChartNode>[] = [
  { header: "Código", value: node => node.code },
  { header: "Cuenta contable", value: node => node.name },
  { header: "Nivel", value: node => levelLabels[node.level] },
  { header: "Naturaleza", value: node => (node.nature === "DEBIT" ? "Débito" : "Crédito") },
  { header: "Origen", value: node => (node.source === "PUC" ? "PUC" : "Organización") },
  { header: "Estado", value: node => (node.active ? "Activa" : "Inactiva") },
  { header: "Débitos", value: node => node.debits, money: true },
  { header: "Créditos", value: node => node.credits, money: true },
  { header: "Saldo", value: node => node.balance, money: true },
];

function ChartOfAccounts() {
  const { company, canExport, canReceive: canEdit } = useSession();
  const report = useReport<{ data: ChartNode[] }>("/v1/accounting/chart");
  const nodes = report.data?.data ?? [];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [codeSearch, setCodeSearch] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const byCode = useMemo(() => new Map(nodes.map(node => [node.code, node])), [nodes]);
  const filtering = Boolean(codeSearch.trim() || nameSearch.trim());

  // Con búsqueda: las coincidencias y sus ancestros, todo expandido. Sin búsqueda: según lo expandido.
  const visible = useMemo(() => {
    if (filtering) {
      const code = codeSearch.trim();
      const name = nameSearch.trim().toLowerCase();
      const matches = nodes.filter(
        node => (!code || node.code.startsWith(code)) && (!name || node.name.toLowerCase().includes(name))
      );
      const keep = new Set<string>();
      for (const match of matches) {
        let current: string | null = match.code;
        while (current) {
          keep.add(current);
          current = parentOf(current);
        }
      }
      return nodes.filter(node => keep.has(node.code));
    }
    return nodes.filter(node => {
      let parent = parentOf(node.code);
      while (parent) {
        if (!expanded.has(parent)) return false;
        parent = parentOf(parent);
      }
      return true;
    });
  }, [nodes, expanded, filtering, codeSearch, nameSearch]);

  const allExpanded = nodes.length > 0 && nodes.filter(node => node.hasChildren).every(node => expanded.has(node.code));
  const toggle = (code: string) => {
    const next = new Set(expanded);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setExpanded(next);
  };
  const download = async () => {
    try {
      await exportReport("xlsx", {
        company,
        title: "Plan de cuentas",
        period: { from: null, to: null },
        filters: [],
        columns: exportColumns,
        rows: nodes,
        totals: [["Cuentas", String(nodes.length)]],
        fileName: "plan-de-cuentas",
      });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };
  const node = selected ? (byCode.get(selected) ?? null) : null;

  return (
    <section className="panel accounting-panel">
      <div className="accounting-head">
        <h2>Cuenta contable</h2>
        <span className="collections-spacer" />
        <button
          type="button"
          className="secondary"
          onClick={download}
          disabled={!canExport || !nodes.length}
          title={canExport ? undefined : "Tu rol no permite descargar"}
        >
          ⤓ Descargar Excel
        </button>
      </div>
      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={report.loading && !report.data} error={report.error} />
      {report.data && (
        <div className="accounting-layout">
          <div className="accounting-tree">
            <button
              type="button"
              className="report-link accounting-expand"
              disabled={filtering}
              onClick={() =>
                setExpanded(
                  allExpanded ? new Set() : new Set(nodes.filter(item => item.hasChildren).map(item => item.code))
                )
              }
            >
              {allExpanded ? "⌃ Contraer todos los detalles" : "⌄ Expandir todos los detalles"}
            </button>
            <table className="accounting-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cuenta contable</th>
                </tr>
                <tr className="accounting-search">
                  <th>
                    <span className="collections-search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        value={codeSearch}
                        onChange={event => setCodeSearch(event.target.value.replace(/\D/g, ""))}
                        placeholder="Buscar por código"
                        aria-label="Buscar por código"
                        inputMode="numeric"
                      />
                    </span>
                  </th>
                  <th>
                    <span className="collections-search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        value={nameSearch}
                        onChange={event => setNameSearch(event.target.value)}
                        placeholder="Buscar por cuenta contable"
                        aria-label="Buscar por cuenta contable"
                      />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map(item => (
                  <tr
                    key={item.code}
                    className={`${item.code === selected ? "is-selected" : ""} ${item.active ? "" : "is-cancelled"}`}
                    onClick={() => setSelected(item.code)}
                  >
                    <td style={{ paddingLeft: 10 + depth(item.code) * 14 }}>
                      {item.hasChildren ? (
                        <button
                          type="button"
                          className="accounting-caret"
                          aria-label={`${expanded.has(item.code) || filtering ? "Contraer" : "Expandir"} ${item.code}`}
                          aria-expanded={expanded.has(item.code) || filtering}
                          onClick={event => {
                            event.stopPropagation();
                            if (!filtering) toggle(item.code);
                          }}
                        >
                          {expanded.has(item.code) || filtering ? "▾" : "▸"}
                        </button>
                      ) : (
                        <span className="accounting-caret-space" />
                      )}
                      {item.code}
                    </td>
                    <td>
                      <button type="button" className="accounting-name" onClick={() => setSelected(item.code)}>
                        {item.name}
                      </button>
                      {item.source === "ORG" && !item.system && <small className="accounting-tag">propia</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <p className="report-message">No hay cuentas con esa búsqueda.</p>}
          </div>
          <div className="accounting-detail">
            {node ? (
              <AccountDetail
                key={node.code}
                node={node}
                canEdit={canEdit}
                onChanged={(text, code) => {
                  setNotice({ kind: "ok", text });
                  report.reload();
                  if (code) {
                    setSelected(code);
                    const next = new Set(expanded);
                    let parent = parentOf(code);
                    while (parent) {
                      next.add(parent);
                      parent = parentOf(parent);
                    }
                    setExpanded(next);
                  }
                }}
                onDeleted={text => {
                  setNotice({ kind: "ok", text });
                  setSelected(parentOf(node.code));
                  report.reload();
                }}
              />
            ) : (
              <p className="accounting-empty">
                Para crear o editar, selecciona una cuenta contable desplegando los grupos de cuentas ubicados en la
                parte izquierda.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function AccountDetail({
  node,
  canEdit,
  onChanged,
  onDeleted,
}: {
  node: ChartNode;
  canEdit: boolean;
  onChanged: (text: string, code?: string) => void;
  onDeleted: (text: string) => void;
}) {
  const [name, setName] = useState(node.name);
  const [active, setActive] = useState(node.active);
  const [child, setChild] = useState({ suffix: "", name: "" });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const run = async (action: () => Promise<unknown>, done: () => void) => {
    setState({ busy: true });
    try {
      await action();
      setState({ busy: false });
      done();
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  const childKind = childLabel[node.level];
  const childCode = child.suffix.length === 2 ? node.code + child.suffix : null;
  return (
    <div className="accounting-card">
      <p className="eyebrow">
        {levelLabels[node.level]} · {node.source === "PUC" ? "PUC" : "de la organización"}
      </p>
      <h3>
        {node.code} · {node.name}
      </h3>
      <div className="accounting-badges">
        <span className="pay-badge">Naturaleza {node.nature === "DEBIT" ? "débito" : "crédito"}</span>
        <span className={node.active ? "pay-badge is-ok" : "pay-badge"}>{node.active ? "Activa" : "Inactiva"}</span>
        {node.system && <span className="pay-badge is-info">Usada por Betel</span>}
        {node.postable && <span className="pay-badge is-pending">De movimiento</span>}
      </div>
      <dl className="accounting-figures">
        <div>
          <dt>Saldo</dt>
          <dd>
            <b>{money(node.balance)}</b>
          </dd>
        </div>
        <div>
          <dt>Débitos</dt>
          <dd>{money(node.debits)}</dd>
        </div>
        <div>
          <dt>Créditos</dt>
          <dd>{money(node.credits)}</dd>
        </div>
        <div>
          <dt>Movimientos</dt>
          <dd>{node.movements}</dd>
        </div>
      </dl>
      <p className="report-hint">
        Saldo acumulado de la cuenta y sus subcuentas con los comprobantes contabilizados.
        {node.system &&
          " La usan los comprobantes automáticos (facturas, recibos, compras, nómina…): no se puede inactivar ni eliminar."}
      </p>

      {node.source === "ORG" && node.id && canEdit && (
        <form
          className="accounting-form"
          onSubmit={event => {
            event.preventDefault();
            run(
              () => apiPut(`/v1/accounting/accounts/${node.id}`, { name: name.trim(), active }),
              () => onChanged(`Cuenta ${node.code} actualizada.`)
            );
          }}
        >
          <h4>Editar cuenta</h4>
          <label className="field">
            Nombre
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              minLength={3}
              maxLength={120}
              required
            />
          </label>
          <label className="events-check">
            <input
              type="checkbox"
              checked={active}
              disabled={node.system}
              onChange={event => setActive(event.target.checked)}
            />
            Activa (se puede usar en comprobantes)
          </label>
          <div className="report-actions">
            <button type="submit" className="primary" disabled={state.busy}>
              Guardar
            </button>
            {!node.system && (
              <button
                type="button"
                className="secondary danger"
                disabled={state.busy || node.movements > 0 || node.hasChildren}
                title={
                  node.movements ? "Tiene movimientos: inactívala" : node.hasChildren ? "Tiene subcuentas" : undefined
                }
                onClick={() =>
                  run(
                    () => apiDelete(`/v1/accounting/accounts/${node.id}`),
                    () => onDeleted(`Cuenta ${node.code} eliminada.`)
                  )
                }
              >
                Eliminar
              </button>
            )}
          </div>
        </form>
      )}

      {childKind && canEdit && (
        <form
          className="accounting-form"
          onSubmit={event => {
            event.preventDefault();
            run(
              () =>
                apiPost("/v1/accounting/accounts", {
                  parentCode: node.code,
                  suffix: child.suffix,
                  name: child.name.trim(),
                }),
              () => onChanged(`Cuenta ${childCode} creada.`, childCode ?? undefined)
            );
          }}
        >
          <h4>
            Crear {childKind} bajo {node.code}
          </h4>
          <div className="accounting-new">
            <label className="field">
              Código
              <span className="accounting-code">
                <b>{node.code}</b>
                <input
                  value={child.suffix}
                  onChange={event => setChild({ ...child, suffix: event.target.value.replace(/\D/g, "").slice(0, 2) })}
                  placeholder="05"
                  inputMode="numeric"
                  pattern="\d{2}"
                  required
                  aria-label="Dos dígitos del código nuevo"
                />
              </span>
            </label>
            <label className="field">
              Nombre
              <input
                value={child.name}
                onChange={event => setChild({ ...child, name: event.target.value })}
                minLength={3}
                maxLength={120}
                required
              />
            </label>
          </div>
          <div className="report-actions">
            <button type="submit" className="primary" disabled={state.busy || !childCode}>
              Crear {childKind}
            </button>
          </div>
        </form>
      )}
      {node.level === "CLASS" && (
        <p className="report-hint">Las clases y grupos son fijos del PUC: despliega un grupo para crear cuentas.</p>
      )}
      {state.error && (
        <p className="report-error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}

const processes: { href: string; title: string; text: string }[] = [
  {
    href: "/contabilidad/balance-de-prueba",
    title: "Balance de prueba",
    text: "Saldo inicial, débitos, créditos y saldo final por clase, grupo, cuenta, subcuenta o auxiliar.",
  },
  {
    href: "/contabilidad/libro-diario",
    title: "Libro diario",
    text: "Todos los comprobantes contables del período, automáticos y manuales, con su detalle.",
  },
  {
    href: "/contabilidad/comprobante/nuevo",
    title: "Comprobante contable",
    text: "Registra un comprobante manual (ajustes, causaciones, reclasificaciones) que cuadre débitos y créditos.",
  },
  { href: "/bancos", title: "Cajas y bancos", text: "Saldo y movimientos de cada caja y cuenta bancaria." },
  {
    href: "/productos?tab=costeo",
    title: "Costeo mensual",
    text: "Costo promedio y costo de ventas contabilizado de cada mes.",
  },
  { href: "/nomina", title: "Nómina", text: "Causación y pago de la nómina." },
];

function MoreProcesses() {
  return (
    <section className="panel">
      <div className="accounting-processes">
        {processes.map(process => (
          <Link key={process.href} href={process.href} className="accounting-process">
            <b>{process.title}</b>
            <span>{process.text}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
