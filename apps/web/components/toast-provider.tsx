"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type ToastKind = "success" | "warning" | "error" | "info";
type ToastInput = { title: string; description?: string };
type Toast = ToastInput & { id: number; kind: ToastKind };
type ToastApi = Record<ToastKind, (input: ToastInput) => void>;

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const sequence = useRef(0);
  const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), []);
  const push = useCallback((kind: ToastKind, input: ToastInput) => {
    const id = ++sequence.current;
    setToasts(current => [...current, { id, kind, ...input }]);
    window.setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    success: input => push("success", input),
    warning: input => push("warning", input),
    error: input => push("error", input),
    info: input => push("info", input),
  }), [push]);

  return <ToastContext.Provider value={api}>
    {children}
    <div className="toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map(toast => <article className={`toast toast-${toast.kind}`} key={toast.id} role={toast.kind === "error" ? "alert" : "status"}>
        <span className="toast-icon" aria-hidden>{toast.kind === "success" ? "✓" : toast.kind === "warning" ? "!" : toast.kind === "error" ? "×" : "i"}</span>
        <div><strong>{toast.title}</strong>{toast.description && <p>{toast.description}</p>}</div>
        <button type="button" onClick={() => dismiss(toast.id)} aria-label="Cerrar notificación">×</button>
      </article>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast debe usarse dentro de ToastProvider.");
  return toast;
}
