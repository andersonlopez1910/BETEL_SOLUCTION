import { AppShell } from "../../../components/app-shell";
import { Dashboard } from "../../../components/dashboard";

export default function HomePage() {
  return (
    <AppShell
      title="Panel de control financiero"
      subtitle="Gestiona tu facturación, impuestos, contabilidad y cumplimiento tributario en un solo lugar."
      headClassName="page-head-financial"
      actions={<button type="button" className="financial-period">▣&nbsp; Este mes⌄</button>}
    >
      <Dashboard />
    </AppShell>
  );
}
