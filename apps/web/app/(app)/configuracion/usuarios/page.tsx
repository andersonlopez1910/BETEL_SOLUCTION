/**
 * Ruta /configuracion/usuarios — Usuarios y permisos. El contenido está en components/users-admin.tsx.
 */
import { AppShell } from "../../../../components/app-shell";
import { UsersAdmin } from "../../../../components/users-admin";

export default function Page() {
  return (
    <AppShell title="Usuarios y permisos" subtitle="Crea los usuarios de la empresa y define qué puede hacer cada uno.">
      <UsersAdmin />
    </AppShell>
  );
}
