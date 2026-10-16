# Betel Solution

Plataforma contable colombiana multiempresa para pymes y empresas en crecimiento. La primera entrega implementa la experiencia de facturación, terceros, documento soporte, calendario, notificaciones, cuenta, perfil y configuración tomando como guía los insumos visuales suministrados.

## Estado de la entrega

- Aplicación web: Next.js 15, React 19 y App Router; diseño responsive y exportación estática para revisión humana.
- API: Fastify + TypeScript, JWT de corta duración, RBAC y validación Zod compartida.
- Datos: PostgreSQL 17 + Prisma; RLS obligatorio para los datos pertenecientes a cada organización.
- Contabilidad: cálculo de descuentos/IVA, comprobantes de partida doble y catálogo base PUC configurable.
- Flujos implementados: terceros, productos, facturas de venta, documentos soporte, calendario, notificaciones y consulta de comprobantes.
- Calidad verificada: typecheck, build estático, pruebas unitarias y prueba de integración local contra PostgreSQL.

## Arquitectura

| Área | Implementación | Responsabilidad |
| --- | --- | --- |
| `apps/web` | Next.js | UI, rutas y experiencia de los módulos contables. |
| `apps/api` | Fastify | Autenticación, autorización, reglas de negocio y API REST. |
| `packages/contracts` | Zod + TypeScript | Contratos y validaciones compartidas. |
| `packages/db` | Prisma + PostgreSQL | Modelo relacional, RLS y acceso transaccional. |
| `docker/` | PostgreSQL 17 | Entorno local reproducible. |

Las decisiones de diseño, aislamiento de datos y próximos pasos están en [docs/architecture.md](docs/architecture.md). El guion de validación está en [docs/human-test.md](docs/human-test.md).

## Requisitos

- Node.js 22 o superior (validado con Node 24).
- Corepack habilitado para usar pnpm 10.
- Docker Desktop/Engine con Docker Compose.
- Git.

En Windows, si PowerShell bloquea `pnpm.ps1`, use siempre `corepack pnpm` como lo hacen los comandos de este repositorio.

## Inicio local

1. Cree `.env` a partir de `.env.example` y cambie los secretos locales.
2. Levante PostgreSQL:

   ```powershell
   docker compose up -d postgres
   ```

3. Instale dependencias y genere Prisma:

   ```powershell
   corepack pnpm install
   corepack pnpm db:generate
   ```

4. Aplique el esquema con el usuario administrador definido en `packages/db/.env`, y habilite las políticas RLS:

   ```powershell
   corepack pnpm db:push
   corepack pnpm db:rls
   ```

5. Inicie web y API:

   ```powershell
   corepack pnpm dev
   ```

   Web: `http://localhost:3000` · Salud de API: `http://localhost:4000/health`.

Para el bootstrap de desarrollo se puede establecer `BETEL_ALLOW_INSECURE_DEV_AUTH=true`. Esta variable **nunca** debe habilitarse en producción; el endpoint correspondiente no se registra con `NODE_ENV=production`.

## Comandos de calidad

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

`build` genera `apps/web/out` y lo prepara en `out`, una versión estática de la interfaz para el entorno de revisión. La API se compila a `apps/api/dist`.

## Seguridad y multitenencia

- Toda ruta de negocio exige JWT; los roles son `OWNER`, `ADMIN`, `ACCOUNTANT`, `SALES`, `SUPPORT` y `VIEWER`.
- El rol efectivo se obtiene de la membresía activa en cada petición, no se confía únicamente en el claim del token.
- Cada transacción de acceso establece `app.organization_id`; PostgreSQL aplica Row-Level Security y `FORCE ROW LEVEL SECURITY` a entidades de organización y sus dependientes.
- La API se conecta con el usuario restringido `betel_app`; el superusuario se reserva para migraciones locales.
- Las acciones relevantes generan `AuditLog`; la IP se guarda como hash salado, no en claro.
- Los comprobantes se validan antes de persistirse: débitos y créditos deben cuadrar a dos decimales.

## Facturación electrónica y cumplimiento colombiano

La plataforma conserva estados DIAN, CUFE/CUDS, resolución y eventos electrónicos. En esta entrega el adaptador DIAN es exclusivamente `sandbox`: al emitir una factura queda en estado `QUEUED` y no transmite documentos reales.

Antes de operar en producción se requiere configurar, por organización y con asesoría contable/tributaria vigente:

1. proveedor tecnológico o integración DIAN habilitada;
2. Software ID, pin, certificado digital y resolución/numeración vigente;
3. reglas de impuestos, retenciones, responsabilidades RUT y catálogo de cuentas de la organización;
4. pruebas de habilitación DIAN y revisión del contador responsable;
5. almacenamiento documental, retención, tratamiento de datos y trazabilidad conforme a las obligaciones aplicables.

No utilice los datos de demostración, el adaptador sandbox ni el catálogo base como sustituto de una parametrización tributaria profesional.

## Despliegue de revisión humana

El manifiesto [.openai/hosting.json](.openai/hosting.json) publica `out` como sitio privado. La interfaz estática se puede revisar visualmente y navegar en un navegador; sus formularios son demostrativos mientras no se configure una URL pública de API.

La API Fastify requiere un runtime de servidor, PostgreSQL administrado, secretos y un proveedor DIAN real. El hosting estático no sustituye dichos componentes. Por tanto, el despliegue de esta entrega es apto para prueba humana de UX, no para emisión fiscal productiva. Tras publicar, registre la URL privada y ejecute el checklist de [docs/human-test.md](docs/human-test.md).

## Licencia y datos

Proyecto de implementación inicial. No cargue NIT, RUT, certificados, llaves privadas ni información real de clientes en los datos de ejemplo o en un entorno de revisión.
