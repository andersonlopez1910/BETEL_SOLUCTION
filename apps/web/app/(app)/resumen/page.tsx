/**
 * Ruta /resumen — Tablero principal con datos reales (components/dashboard.tsx, GET /v1/dashboard):
 * ingresos, gastos, utilidad y margen del mes, evolución de resultados, flujo de caja y accesos rápidos.
 */
import { AppShell } from "../../../components/app-shell";
import { Dashboard } from "../../../components/dashboard";

export default function Summary() {
  return (
    <AppShell
      title={
        <>
          Bienvenido a <span className="brand-text">BETEL Solution</span>
        </>
      }
      subtitle="Gestión financiera, contable y tributaria en un solo lugar."
      headClassName="page-head-welcome"
    >
      <Dashboard />
    </AppShell>
  );
}
