/**
 * Cliente HTTP del frontend hacia la API. En desarrollo se consume desde el mismo
 * origen de la web (localhost:3000), que la reenvía internamente a la API.
 *
 * Uso:
 *   const report = await apiGet<SalesReport>("/v1/reports/billing/sales", { from: "2026-11-01" });
 *   await apiPost("/v1/cash-receipts/" + id + "/void", { reason: "Consignación devuelta" });
 * Los parámetros vacíos o undefined no se envían. Si la API responde con error, lanza ApiError
 * con el mensaje `error` del cuerpo (los textos ya vienen en español desde la API).
 *
 * SESIÓN (PROVISIONAL): todavía no existe pantalla de inicio de sesión. En desarrollo se usa
 * POST /v1/auth/dev/session (requiere BETEL_ALLOW_INSECURE_DEV_AUTH=true en la API) y el token se
 * guarda en sessionStorage; al vencer (401) se pide uno nuevo.
 * PENDIENTE: reemplazar por el login real (OIDC + MFA) antes de producción (ver docs/TAREAS.md).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window === "undefined" ? "http://localhost:3000" : window.location.origin);
const TOKEN_KEY = "betel.accessToken";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Cuerpo completo de la respuesta de error (p. ej. errores por fila de una importación). */
    readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export type QueryParams = Record<string, string | number | undefined>;

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // Almacenamiento bloqueado (modo privado, etc.): se pide sesión en cada carga.
  }
}

// Varias consultas simultáneas comparten la misma petición de sesión.
let sessionRequest: Promise<string> | null = null;

function requestDevSession() {
  sessionRequest ??= fetch(`${API_URL}/v1/auth/dev/session`, { method: "POST" })
    .then(async response => {
      if (!response.ok)
        throw new ApiError(
          "No hay sesión iniciada. El inicio de sesión aún no está implementado; en desarrollo active BETEL_ALLOW_INSECURE_DEV_AUTH en la API.",
          response.status
        );
      const { accessToken } = (await response.json()) as { accessToken: string };
      try {
        sessionStorage.setItem(TOKEN_KEY, accessToken);
      } catch {}
      return accessToken;
    })
    .finally(() => (sessionRequest = null));
  return sessionRequest;
}

/** Petición autenticada a la API. Devuelve el cuerpo JSON tal cual. */
async function apiRequest<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params: QueryParams = {},
  body?: unknown
): Promise<T> {
  const url = new URL(path, API_URL);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));

  const send = (token: string) =>
    fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let response: Response;
  try {
    response = await send(readToken() ?? (await requestDevSession()));
    if (response.status === 401) response = await send(await requestDevSession());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`No se pudo conectar con la API (${API_URL}). Verifique que esté en ejecución.`, 0);
  }

  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new ApiError(
      result.error ?? `Error ${response.status} de la API.`,
      response.status,
      result as Record<string, unknown>
    );
  return result as T;
}

/** GET autenticado a la API. */
export const apiGet = <T>(path: string, params: QueryParams = {}) => apiRequest<T>("GET", path, params);

/** POST autenticado con cuerpo JSON (crear recibos, anular, enviar correos). */
export const apiPost = <T>(path: string, body: unknown = {}) => apiRequest<T>("POST", path, {}, body);

/** PUT autenticado con cuerpo JSON (editar un registro completo, p. ej. un producto). */
export const apiPut = <T>(path: string, body: unknown) => apiRequest<T>("PUT", path, {}, body);

/** DELETE autenticado (eliminar un registro sin historial, p. ej. un producto que ningún documento usa). */
export const apiDelete = <T>(path: string) => apiRequest<T>("DELETE", path);

/** Descarga protegida para documentos que el navegador abrirá desde un Blob URL. */
export async function apiGetBlob(path: string) {
  const url = new URL(path, API_URL);
  // Una representación de factura puede regenerarse al corregir la plantilla;
  // nunca reutilizamos un Blob PDF en caché del navegador.
  const send = (token: string) => fetch(url, { cache: "no-store", headers: { authorization: `Bearer ${token}` } });
  let response: Response;
  try {
    response = await send(readToken() ?? (await requestDevSession()));
    if (response.status === 401) response = await send(await requestDevSession());
  } catch {
    throw new ApiError("No se pudo conectar con la API.", 0);
  }
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(result.error ?? "No se pudo abrir el documento.", response.status, result);
  }
  return response.blob();
}
