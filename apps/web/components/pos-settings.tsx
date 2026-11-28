/**
 * Configuración › DIAN y documentos › Documento equivalente POS (/configuracion/pos): resolución DIAN de la
 * numeración POS (número, fecha, rango y vigencia), WhatsApp y mensaje de la tirilla.
 * API: GET/PUT /v1/organization/pos-settings (apps/api/src/pos.ts). Sin resolución vigente no se emite un POS.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiPut } from "../lib/api";
import { date, ReportStatus, useReport, useSession } from "./billing-report-common";
import { PhoneField } from "./phone-field";

type Settings = {
  posPrefix: string;
  posResolutionNumber: string | null;
  posResolutionDate: string | null;
  posRangeFrom: number | null;
  posRangeTo: number | null;
  posValidityMonths: number | null;
  whatsapp: string | null;
  receiptFooter: string | null;
  expiresOn: string | null;
  used: number;
  resolutionText: string | null;
};

export function PosSettings() {
  const settings = useReport<{ data: Settings }>("/v1/organization/pos-settings");
  const { can } = useSession();
  const editable = can("settings.manage");
  const [form, setForm] = useState({
    posPrefix: "POS",
    posResolutionNumber: "",
    posResolutionDate: "",
    posRangeFrom: "",
    posRangeTo: "",
    posValidityMonths: "24",
    whatsapp: "",
    receiptFooter: "",
  });
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const data = settings.data?.data;
  useEffect(() => {
    if (!data) return;
    setForm({
      posPrefix: data.posPrefix,
      posResolutionNumber: data.posResolutionNumber ?? "",
      posResolutionDate: data.posResolutionDate ?? "",
      posRangeFrom: data.posRangeFrom ? String(data.posRangeFrom) : "",
      posRangeTo: data.posRangeTo ? String(data.posRangeTo) : "",
      posValidityMonths: data.posValidityMonths ? String(data.posValidityMonths) : "24",
      whatsapp: data.whatsapp ?? "",
      receiptFooter: data.receiptFooter ?? "",
    });
  }, [data]);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: event.target.value });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await apiPut("/v1/organization/pos-settings", {
        ...form,
        posPrefix: form.posPrefix.toUpperCase(),
        posRangeFrom: Number(form.posRangeFrom),
        posRangeTo: Number(form.posRangeTo),
        posValidityMonths: Number(form.posValidityMonths),
      });
      setNotice({ text: "Resolución POS guardada. Los próximos documentos POS usan esta numeración." });
      settings.reload();
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  const status = !data?.resolutionText
    ? { label: "Sin resolución", tone: "pending" }
    : data.expiresOn && data.expiresOn <= today
      ? { label: "Vencida", tone: "error" }
      : { label: "Vigente", tone: "ready" };
  const available = data?.posRangeFrom && data.posRangeTo ? data.posRangeTo - data.posRangeFrom + 1 - data.used : null;

  return (
    <div className="page-content">
      <Link href="/configuracion" className="report-link">
        ‹ Volver a Configuración
      </Link>
      <ReportStatus loading={settings.loading && !data} error={settings.error} />
      {data && (
        <div className="pos-settings">
          <form className="panel pos-settings-form" onSubmit={save}>
            <h2>Resolución DIAN de numeración POS</h2>
            <p className="report-footnote">
              La DIAN autoriza un rango de numeración para el documento equivalente electrónico POS. Sin una resolución
              vigente, Betel no emite documentos POS.
            </p>
            <fieldset disabled={!editable || busy}>
              <div className="pos-grid">
                <label className="field">
                  Prefijo
                  <input
                    value={form.posPrefix}
                    onChange={event =>
                      setForm({
                        ...form,
                        posPrefix: event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, "")
                          .slice(0, 6),
                      })
                    }
                    required
                  />
                </label>
                <label className="field">
                  Número de resolución
                  <input
                    value={form.posResolutionNumber}
                    onChange={event => setForm({ ...form, posResolutionNumber: event.target.value.replace(/\D/g, "") })}
                    inputMode="numeric"
                    required
                    placeholder="18764000000000"
                  />
                </label>
                <label className="field">
                  Fecha de la resolución
                  <input type="date" value={form.posResolutionDate} onChange={set("posResolutionDate")} required />
                </label>
                <label className="field">
                  Vigencia (meses)
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={form.posValidityMonths}
                    onChange={set("posValidityMonths")}
                    required
                  />
                </label>
                <label className="field">
                  Número inicial
                  <input type="number" min="1" value={form.posRangeFrom} onChange={set("posRangeFrom")} required />
                </label>
                <label className="field">
                  Número final
                  <input type="number" min="1" value={form.posRangeTo} onChange={set("posRangeTo")} required />
                </label>
              </div>
              <h3>Datos de la tirilla</h3>
              <div className="pos-grid">
                <PhoneField
                  label="WhatsApp"
                  className="field"
                  value={form.whatsapp}
                  onChange={whatsapp => setForm({ ...form, whatsapp })}
                />
                <label className="field pos-wide">
                  Mensaje al final de la tirilla
                  <input
                    value={form.receiptFooter}
                    onChange={set("receiptFooter")}
                    maxLength={160}
                    placeholder="¡Gracias por tu visita! Vuelve pronto."
                  />
                </label>
              </div>
            </fieldset>
            {notice && (
              <p className={notice.error ? "collections-notice is-error" : "collections-notice"} role="status">
                {notice.text}
              </p>
            )}
            {editable ? (
              <div className="report-dialog-actions">
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? "Guardando…" : "Guardar resolución"}
                </button>
              </div>
            ) : (
              <p className="report-footnote">Tu rol puede consultar esta configuración, pero no editarla.</p>
            )}
          </form>
          <aside className="panel pos-status">
            <h3>Estado</h3>
            <span className={`pos-badge is-${status.tone}`}>{status.label}</span>
            <dl>
              <div>
                <dt>Documentos POS emitidos</dt>
                <dd>{data.used}</dd>
              </div>
              <div>
                <dt>Números disponibles</dt>
                <dd>{available ?? "—"}</dd>
              </div>
              <div>
                <dt>Vence</dt>
                <dd>{data.expiresOn ? date(data.expiresOn) : "—"}</dd>
              </div>
            </dl>
            {data.resolutionText && (
              <>
                <h3>Así sale en la tirilla</h3>
                <p className="pos-resolution-preview">{data.resolutionText}</p>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
