/**
 * Configuración › Usuarios y permisos (/configuracion/usuarios): usuarios de la empresa, su rol y estado, y la tabla
 * de qué puede hacer cada rol. API: apps/api/src/users.ts (solo OWNER y ADMIN; la API valida cada regla).
 * En desarrollo, «Probar como» entra con el usuario elegido para ver Betel con sus permisos; el banner superior
 * (ImpersonationBanner en app-shell) permite volver al usuario original.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiPost, apiPut } from "../lib/api";
import { date, ReportStatus, useReport } from "./billing-report-common";
import { Modal } from "./collection-dialogs";
import { PhoneField } from "./phone-field";

export type Role = "OWNER" | "ADMIN" | "ACCOUNTANT" | "SALES" | "SUPPORT" | "VIEWER";
type User = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  createdAt: string;
};
type UsersResponse = { data: User[]; currentUserId: string; devLogin: boolean };

export const roleInfo: Record<Role, { label: string; description: string }> = {
  OWNER: { label: "Propietario", description: "Todo, incluida la gestión de propietarios y usuarios." },
  ADMIN: { label: "Administrador", description: "Todo; gestiona usuarios (salvo propietarios) y la configuración." },
  ACCOUNTANT: {
    label: "Contador",
    description: "Toda la operación contable y financiera; no gestiona usuarios ni la configuración de la empresa.",
  },
  SALES: {
    label: "Ventas",
    description: "Cotizaciones, remisiones, facturas en borrador, terceros y productos; consulta reportes.",
  },
  SUPPORT: { label: "Soporte", description: "Acceso técnico sin información financiera." },
  VIEWER: { label: "Solo lectura", description: "Consulta reportes; no crea, emite ni descarga." },
};
const roles = Object.keys(roleInfo) as Role[];

type Draft = { id?: string; displayName: string; email: string; phone: string; role: Role };
const emptyDraft: Draft = { displayName: "", email: "", phone: "", role: "SALES" };

export function UsersAdmin() {
  const users = useReport<UsersResponse>("/v1/organization/users");
  const me = useReport<{ user: { role: Role }; organization: { nit: string } }>("/v1/me");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const isOwner = me.data?.user.role === "OWNER";

  const toggleActive = async (user: User) => {
    setNotice(null);
    setBusyId(user.id);
    try {
      await apiPut(`/v1/organization/users/${user.id}`, { active: !user.active });
      setNotice({
        text: `${user.displayName} quedó ${user.active ? "desactivado: ya no puede entrar" : "activo de nuevo"}.`,
      });
      users.reload();
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
    } finally {
      setBusyId(null);
    }
  };

  const tryAs = async (user: User) => {
    setNotice(null);
    try {
      const session = await apiPost<{ accessToken: string }>("/v1/auth/dev/session", {
        email: user.email,
        organizationNit: me.data?.organization.nit,
      });
      try {
        // Se guarda la sesión original para volver desde el banner superior.
        if (!sessionStorage.getItem("betel.originalToken"))
          sessionStorage.setItem("betel.originalToken", sessionStorage.getItem("betel.accessToken") ?? "");
        sessionStorage.setItem("betel.accessToken", session.accessToken);
        sessionStorage.setItem("betel.impersonating", `${user.displayName} (${roleInfo[user.role].label})`);
      } catch {}
      window.location.href = "/inicio";
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
    }
  };

  if (users.error)
    return (
      <div className="page-content">
        <Link href="/configuracion" className="report-link">
          ‹ Volver a Configuración
        </Link>
        <p className="collections-notice is-error" role="alert">
          {/403/.test(users.error) || /permiso/i.test(users.error)
            ? "Solo el propietario o un administrador gestiona los usuarios de la empresa."
            : users.error}
        </p>
      </div>
    );

  return (
    <div className="page-content users-admin">
      <div className="document-toolbar">
        <Link href="/configuracion" className="report-link">
          ‹ Volver a Configuración
        </Link>
        <button type="button" className="primary" onClick={() => setDraft({ ...emptyDraft })}>
          + Nuevo usuario
        </button>
      </div>
      {notice && (
        <p className={notice.error ? "collections-notice is-error" : "collections-notice"} role="status">
          {notice.text}
        </p>
      )}
      <section className="panel">
        <h2 className="users-title">Usuarios de la empresa</h2>
        <ReportStatus loading={users.loading && !users.data} error={undefined} />
        {users.data && (
          <div className="report-table-wrap">
            <table className="report-table users-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Celular</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Desde</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.data.data.map(user => {
                  const self = user.id === users.data!.currentUserId;
                  const ownerLocked = user.role === "OWNER" && !isOwner;
                  return (
                    <tr key={user.id} className={user.active ? undefined : "is-inactive"}>
                      <td>
                        <b>{user.displayName}</b>
                        {self && <small className="users-you">Tú</small>}
                      </td>
                      <td>{user.email}</td>
                      <td>{user.phone ? `+57 ${user.phone}` : "—"}</td>
                      <td>
                        <span className={`role-badge role-${user.role.toLowerCase()}`}>
                          {roleInfo[user.role].label}
                        </span>
                      </td>
                      <td>{user.active ? "Activo" : "Desactivado"}</td>
                      <td>{date(user.createdAt.slice(0, 10))}</td>
                      <td className="users-actions">
                        <button
                          type="button"
                          className="report-link"
                          disabled={ownerLocked}
                          title={ownerLocked ? "Solo un propietario modifica a otro propietario." : undefined}
                          onClick={() =>
                            setDraft({
                              id: user.id,
                              displayName: user.displayName,
                              email: user.email,
                              phone: user.phone ?? "",
                              role: user.role,
                            })
                          }
                        >
                          Editar
                        </button>
                        {!self && (
                          <button
                            type="button"
                            className="report-link"
                            disabled={ownerLocked || busyId === user.id}
                            onClick={() => toggleActive(user)}
                          >
                            {user.active ? "Desactivar" : "Activar"}
                          </button>
                        )}
                        {users.data!.devLogin && !self && user.active && (
                          <button
                            type="button"
                            className="report-link"
                            title="Solo en desarrollo: entra con este usuario para ver Betel con sus permisos."
                            onClick={() => tryAs(user)}
                          >
                            Probar como
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="report-footnote">
          Desactivar quita el acceso de inmediato y conserva todo lo que el usuario registró. El inicio de sesión con
          contraseña aún está en desarrollo; por ahora los usuarios entran con el acceso de desarrollo.
        </p>
      </section>

      <PermissionsEditor isOwner={isOwner} />

      {draft && (
        <UserDialog
          draft={draft}
          canAssignOwner={isOwner}
          isSelf={draft.id === users.data?.currentUserId}
          onClose={() => setDraft(null)}
          onSaved={message => {
            setDraft(null);
            setNotice({ text: message });
            users.reload();
          }}
        />
      )}
    </div>
  );
}

function UserDialog({
  draft: initial,
  canAssignOwner,
  isSelf,
  onClose,
  onSaved,
}: {
  draft: Draft;
  canAssignOwner: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = !!draft.id;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        await apiPut(`/v1/organization/users/${draft.id}`, {
          displayName: draft.displayName,
          phone: draft.phone,
          ...(!isSelf && { role: draft.role }),
        });
        onSaved(`Se actualizó a ${draft.displayName}.`);
      } else {
        await apiPost("/v1/organization/users", draft);
        onSaved(`${draft.displayName} ya es usuario con el rol ${roleInfo[draft.role].label}.`);
      }
    } catch (saveError) {
      setError((saveError as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={editing ? "Editar usuario" : "Nuevo usuario"} onClose={onClose} wide closeButton>
      <form className="user-form" onSubmit={submit}>
        <label className="field">
          Nombre completo
          <input
            required
            minLength={3}
            value={draft.displayName}
            onChange={event => setDraft({ ...draft, displayName: event.target.value })}
          />
        </label>
        <label className="field">
          Correo
          <input
            required
            type="email"
            value={draft.email}
            readOnly={editing}
            onChange={event => setDraft({ ...draft, email: event.target.value })}
          />
          {editing && <small className="field-help">El correo identifica al usuario y no se cambia.</small>}
        </label>
        <PhoneField className="field" value={draft.phone} onChange={phone => setDraft({ ...draft, phone })} />
        <fieldset className="user-roles" disabled={isSelf}>
          <legend>Rol{isSelf ? " (no puedes cambiar tu propio rol)" : ""}</legend>
          {roles
            .filter(role => role !== "OWNER" || canAssignOwner || initial.role === "OWNER")
            .map(role => (
              <label key={role} className={draft.role === role ? "user-role is-selected" : "user-role"}>
                <input
                  type="radio"
                  name="role"
                  checked={draft.role === role}
                  onChange={() => setDraft({ ...draft, role })}
                />
                <span>
                  <b>{roleInfo[role].label}</b>
                  <small>{roleInfo[role].description}</small>
                </span>
              </label>
            ))}
        </fieldset>
        {error && (
          <p className="report-error" role="alert">
            {error}
          </p>
        )}
        <div className="report-dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear usuario"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Banner «Estás probando como …» (solo desarrollo): vuelve a la sesión original. */
export function ImpersonationBanner() {
  const [label, setLabel] = useState<string | null>(null);
  // Se lee después de montar: el HTML estático no conoce la sesión del navegador.
  useEffect(() => {
    try {
      setLabel(sessionStorage.getItem("betel.impersonating"));
    } catch {}
  }, []);
  if (!label) return null;
  const back = () => {
    try {
      const original = sessionStorage.getItem("betel.originalToken");
      if (original) sessionStorage.setItem("betel.accessToken", original);
      else sessionStorage.removeItem("betel.accessToken");
      sessionStorage.removeItem("betel.originalToken");
      sessionStorage.removeItem("betel.impersonating");
    } catch {}
    window.location.href = "/configuracion/usuarios";
  };
  return (
    <div className="impersonation-banner" role="status">
      Estás probando Betel como <b>{label}</b> (solo desarrollo).
      <button type="button" onClick={back}>
        Volver a mi usuario
      </button>
    </div>
  );
}

type PermissionsResponse = {
  data: {
    permissions: { key: string; area: string; action: string; defaults: Role[] }[];
    matrix: Record<Role, Record<string, boolean>>;
    customized: boolean;
    canEdit: boolean;
  };
};

/**
 * Tabla de permisos por rol. El propietario la edita (casillas) y guarda; la columna Propietario es fija (siempre
 * todo). Los demás la ven de solo lectura. API: GET/PUT /v1/organization/permissions; la API aplica estos permisos
 * en cada ruta (allowPermission en apps/api/src/auth.ts).
 */
function PermissionsEditor({ isOwner }: { isOwner: boolean }) {
  const permissions = useReport<PermissionsResponse>("/v1/organization/permissions");
  const [draft, setDraft] = useState<Record<Role, Record<string, boolean>> | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const data = permissions.data?.data;
  const matrix = draft ?? data?.matrix;
  const editable = !!data?.canEdit && isOwner;
  const dirty = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.matrix);

  const toggle = (role: Role, key: string) => {
    if (!matrix || role === "OWNER") return;
    setNotice(null);
    setDraft({ ...matrix, [role]: { ...matrix[role], [key]: !matrix[role][key] } });
  };
  const save = async (next: Record<Role, Record<string, boolean>>, message: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await apiPut("/v1/organization/permissions", { matrix: next });
      setDraft(null);
      setNotice({ text: message });
      permissions.reload();
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };
  const defaults = () =>
    Object.fromEntries(
      roles.map(role => [
        role,
        Object.fromEntries(
          (data?.permissions ?? []).map(item => [item.key, role === "OWNER" || item.defaults.includes(role)])
        ),
      ])
    ) as Record<Role, Record<string, boolean>>;

  return (
    <section className="panel">
      <div className="permissions-heading">
        <h2 className="users-title">Permisos por rol</h2>
        {editable && (
          <div className="permissions-actions">
            {data?.customized && (
              <button
                type="button"
                className="secondary"
                disabled={saving}
                onClick={() => save(defaults(), "Se restablecieron los permisos predeterminados.")}
              >
                Restablecer predeterminados
              </button>
            )}
            <button type="button" className="secondary" disabled={!dirty || saving} onClick={() => setDraft(null)}>
              Descartar
            </button>
            <button
              type="button"
              className="primary"
              disabled={!dirty || saving}
              onClick={() =>
                draft && save(draft, "Permisos guardados. Aplican de inmediato a todos los usuarios de cada rol.")
              }
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        )}
      </div>
      <p className="report-footnote permissions-help">
        {editable
          ? "Marca o desmarca qué puede hacer cada rol y guarda. El propietario siempre tiene todos los permisos."
          : "Solo el propietario puede editar los permisos."}
        {data?.customized ? " Esta empresa tiene permisos personalizados." : ""}
      </p>
      {notice && (
        <p className={notice.error ? "collections-notice is-error" : "collections-notice"} role="status">
          {notice.text}
        </p>
      )}
      <div className="role-cards">
        {roles.map(role => (
          <div key={role} className="role-card">
            <span className={`role-badge role-${role.toLowerCase()}`}>{roleInfo[role].label}</span>
            <p>{roleInfo[role].description}</p>
          </div>
        ))}
      </div>
      <ReportStatus loading={permissions.loading && !data} error={permissions.error} />
      {data && matrix && (
        <div className="report-table-wrap">
          <table className="report-table permissions-table">
            <thead>
              <tr>
                <th>Permiso</th>
                {roles.map(role => (
                  <th key={role}>{roleInfo[role].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.permissions.map(item => (
                <tr key={item.key}>
                  <td className="permission-name">
                    <b>{item.area}</b>
                    <small>{item.action}</small>
                  </td>
                  {roles.map(role => {
                    const allowed = !!matrix[role]?.[item.key];
                    const changed = !!draft && allowed !== !!data.matrix[role]?.[item.key];
                    return (
                      <td
                        key={role}
                        className={`${allowed ? "is-allowed" : "is-denied"}${changed ? " is-changed" : ""}`}
                      >
                        {editable ? (
                          <input
                            type="checkbox"
                            checked={allowed}
                            disabled={role === "OWNER" || saving}
                            title={role === "OWNER" ? "El propietario siempre tiene todos los permisos." : undefined}
                            aria-label={`${roleInfo[role].label}: ${item.area} · ${item.action}`}
                            onChange={() => toggle(role, item.key)}
                          />
                        ) : allowed ? (
                          "✓"
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="report-footnote">
        La API valida estos permisos en cada acción, aunque alguien intente entrar directo a una dirección. Las reglas
        de usuarios son fijas: solo un propietario asigna ese rol, nadie cambia su propio rol y siempre queda un
        propietario.
      </p>
    </section>
  );
}
