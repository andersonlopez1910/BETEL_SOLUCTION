/**
 * Layout del grupo (app). Los paréntesis en el nombre de carpeta NO aparecen en la URL:
 * agrupan las pantallas internas. Cada página usa <AppShell> directamente.
 */
import { AppShell } from "../../components/app-shell";
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
