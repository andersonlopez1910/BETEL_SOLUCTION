/**
 * Permisos editables por rol (Configuración › Usuarios y permisos).
 *
 * Cada ruta protegida pide un permiso con `allowPermission("clave")` (auth.ts). Qué roles lo tienen sale de:
 *   1. Organization.rolePermissions (lo que el propietario cambió en la tabla), o si no,
 *   2. los valores por defecto de PERMISSIONS (los mismos roles que antes estaban fijos en cada ruta).
 * El rol OWNER siempre tiene todos los permisos (no se puede quitar) para que nadie quede sin acceso.
 */
import type { MembershipRole } from "./auth.js";

const ALL: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES", "SUPPORT", "VIEWER"];
const SELLERS: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES"];
const BACK_OFFICE: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];
const READERS: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES", "VIEWER"];
const MANAGERS: MembershipRole[] = ["OWNER", "ADMIN"];

export const PERMISSIONS = [
  { key: "invoices.create", area: "Facturas de venta", action: "Crear borradores", defaults: SELLERS },
  { key: "invoices.issue", area: "Facturas de venta", action: "Emitir y anular", defaults: BACK_OFFICE },
  {
    key: "sales.documents",
    area: "Cotizaciones, remisiones, recurrentes y seguimiento comercial",
    action: "Crear y gestionar",
    defaults: SELLERS,
  },
  {
    key: "receipts.manage",
    area: "Recibos de caja y pagos en línea",
    action: "Registrar y anular",
    defaults: BACK_OFFICE,
  },
  { key: "sales.send", area: "Correos y links de pago", action: "Enviar", defaults: SELLERS },
  { key: "parties.edit", area: "Terceros y productos", action: "Crear y editar", defaults: SELLERS },
  { key: "products.delete", area: "Productos", action: "Eliminar", defaults: BACK_OFFICE },
  {
    key: "purchases.manage",
    area: "Compras, gastos, proveedores y documentos soporte",
    action: "Registrar y pagar",
    defaults: BACK_OFFICE,
  },
  { key: "inventory.manage", area: "Inventario y costeo", action: "Registrar y calcular", defaults: BACK_OFFICE },
  { key: "payroll.manage", area: "Nómina", action: "Liquidar, aprobar y pagar", defaults: BACK_OFFICE },
  { key: "chart.view", area: "Plan de cuentas", action: "Consultar (con saldos)", defaults: READERS },
  {
    key: "accounting.manage",
    area: "Contabilidad y estados financieros",
    action: "Libros, comprobantes y estados",
    defaults: BACK_OFFICE,
  },
  {
    key: "accounting.entries",
    area: "Asientos contables (lista simple)",
    action: "Consultar",
    defaults: ["OWNER", "ADMIN", "ACCOUNTANT", "VIEWER"],
  },
  {
    key: "reports.view",
    area: "Reportes y tablero",
    action: "Consultar facturación, compras, bancos y productos",
    defaults: READERS,
  },
  {
    key: "reports.financial",
    area: "Reportes",
    action: "Consultar cartera, compras, nómina, libros y auditoría",
    defaults: BACK_OFFICE,
  },
  { key: "reports.export", area: "Reportes", action: "Descargar (PDF, Excel, CSV)", defaults: BACK_OFFICE },
  { key: "calendar.manage", area: "Calendario", action: "Crear eventos", defaults: BACK_OFFICE },
  { key: "settings.manage", area: "Configuración de la empresa e impuestos", action: "Editar", defaults: MANAGERS },
  { key: "users.manage", area: "Usuarios", action: "Crear, editar y desactivar", defaults: MANAGERS },
] as const satisfies readonly { key: string; area: string; action: string; defaults: readonly MembershipRole[] }[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export const ROLES_WITH_EDITABLE_PERMISSIONS = ALL.filter(role => role !== "OWNER");
const byKey = new Map<string, (typeof PERMISSIONS)[number]>(PERMISSIONS.map(item => [item.key, item]));

/** Cambios guardados por la empresa: { ROL: { clave: true|false } } (solo lo que difiere del valor por defecto). */
export type PermissionOverrides = Partial<Record<MembershipRole, Partial<Record<string, boolean>>>>;

export function hasPermission(role: MembershipRole, key: PermissionKey, overrides?: PermissionOverrides | null) {
  if (role === "OWNER") return true;
  const override = overrides?.[role]?.[key];
  if (typeof override === "boolean") return override;
  return (byKey.get(key)?.defaults as readonly MembershipRole[] | undefined)?.includes(role) ?? false;
}

/** Permisos efectivos de un rol (lista de claves). */
export function permissionsOf(role: MembershipRole, overrides?: PermissionOverrides | null) {
  return PERMISSIONS.filter(item => hasPermission(role, item.key, overrides)).map(item => item.key);
}

/** Tabla completa rol × permiso. */
export function permissionMatrix(overrides?: PermissionOverrides | null) {
  return Object.fromEntries(
    ALL.map(role => [
      role,
      Object.fromEntries(PERMISSIONS.map(item => [item.key, hasPermission(role, item.key, overrides)])),
    ])
  ) as Record<MembershipRole, Record<PermissionKey, boolean>>;
}

/**
 * Convierte la tabla editada en los cambios a guardar: solo lo que difiere del valor por defecto. Ignora OWNER
 * (siempre todo) y claves o roles desconocidos.
 */
export function overridesFromMatrix(
  matrix: Partial<Record<string, Partial<Record<string, boolean>>>>
): PermissionOverrides {
  const result: PermissionOverrides = {};
  for (const role of ROLES_WITH_EDITABLE_PERMISSIONS) {
    for (const item of PERMISSIONS) {
      const value = matrix[role]?.[item.key];
      if (typeof value !== "boolean") continue;
      const byDefault = (item.defaults as readonly MembershipRole[]).includes(role);
      if (value !== byDefault) (result[role] ??= {})[item.key] = value;
    }
  }
  return result;
}
