# Arquitectura inicial — Betel Solution

## Decisiones

| Capa | Elección | Motivo |
| --- | --- | --- |
| Web | Next.js 15, React 19, App Router | Rendimiento, rutas tipadas, rendering híbrido y UX operativa. |
| API | Fastify + TypeScript | Baja latencia, esquema de contratos y despliegue liviano. |
| Datos | PostgreSQL 17 + Prisma 6 | Integridad relacional, transacciones y migraciones auditables. |
| Monorepo | pnpm workspaces + Turborepo | Contratos y herramientas compartidas, builds selectivos. |

## Fronteras de dominio

- `Organization` es el límite de tenencia. Toda consulta de negocio deberá filtrarse por `organizationId` obtenido desde el token de sesión, nunca desde el cuerpo enviado por el cliente.
- Los comprobantes contables se registran mediante `JournalEntry` y `JournalLine`. Los documentos emitidos no deben editarse: se anulan o ajustan por notas y se conserva la bitácora `AuditLog`.
- Las facturas y documentos soporte separan el estado interno del estado de transmisión DIAN. `ElectronicEvent` conserva el intercambio con el proveedor tecnológico.
- Certificados, PIN, Software ID y claves de proveedor nunca se guardan en columnas de negocio ni se exponen al frontend; deben residir en un gestor de secretos administrado.

## Seguridad a incorporar antes de producción

1. OIDC con MFA, RBAC por organización y permisos de menor privilegio.
2. RLS de PostgreSQL como defensa adicional a la capa de aplicación.
3. Cifrado de adjuntos y secretos, rotación de certificados y retención documentada.
4. Idempotencia de emisión, firma/verificación de webhooks y colas para DIAN.
5. Auditoría inmutable, respaldos cifrados y recuperación probada.

## Alcance fiscal

El modelo incluye los datos operativos para facturación electrónica, documento soporte, CUDS/CUFE, resolución y responsabilidades. Antes de operar en producción se debe verificar la parametrización vigente ante DIAN, las reglas de validación aplicables al contribuyente y la integración con un proveedor tecnológico habilitado. Una revisión contable y jurídica especializada sigue siendo necesaria por cada cliente y régimen.

## Próximas iteraciones

1. Autenticación, sesiones y RLS multiempresa.
2. CRUD persistente y pruebas de contrato para terceros, productos y documentos.
3. Motor contable de doble partida con validación de saldo y cierres.
4. Adaptador DIAN, certificados y entorno de habilitación.
5. Carga segura de documentos, plan/pagos y observabilidad.

## Roles de base de datos

La API usa `betel_app`, un rol sin `SUPERUSER` ni `BYPASSRLS`; el usuario `betel` queda reservado a inicialización y migraciones. Esta separación es imprescindible: un superusuario puede evitar las políticas RLS, aunque estas tengan `FORCE ROW LEVEL SECURITY`.
