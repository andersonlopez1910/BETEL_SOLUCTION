# Tablero de tareas — Betel Solution

Este archivo es el **backlog inicial**. La fuente oficial de trabajo es el tablero de
**GitHub Projects** del repositorio (pestaña _Projects_): cada fila de esta tabla se convierte
en un _Issue_ con la plantilla "Tarea".

## Reglas para no pisarnos

1. **Nadie programa algo sin un Issue asignado a su nombre.** Si el Issue está en "En progreso"
   con otra persona, ese módulo no se toca.
2. Una tarea = una rama = un Pull Request. Nombre de rama: `feature/<n°-issue>-<descripcion>`,
   p. ej. `feature/5-terceros-api`.
3. En el PR escribir `Closes #<n°>` para que el Issue se cierre solo al fusionar.
4. Otra persona revisa y aprueba el PR antes de fusionarlo en `develop`.
5. Dividir por **módulo completo** (pantalla + API + validación), no por capa, para trabajar
   en carpetas distintas.
6. Si una tarea depende de otra, se indica en la columna _Depende de_.

## Columnas del tablero

`Backlog` → `Por hacer` → `En progreso` → `En revisión` → `Hecho`

## Etiquetas sugeridas

`modulo:terceros` · `modulo:facturacion` · `modulo:doc-soporte` · `modulo:productos` ·
`modulo:calendario` · `modulo:auth` · `api` · `web` · `base-datos` · `bug` · `documentacion` ·
`prioridad:alta`

## Hecho

- [x] **#0 Preparación del repositorio** — `.gitignore` de compilados, configuración VS Code,
      Prettier, versiones fijas, comentarios en todo el código, este tablero. _(rama `feature/preparacion-equipo`)_

## Backlog inicial

| #   | Tarea                                                                                              | Módulo      | Depende de | Responsable |
| --- | -------------------------------------------------------------------------------------------------- | ----------- | ---------- | ----------- |
| 1   | Corregir resaltado del menú lateral (bug documentado en `app-shell.tsx`)                           | web         | —          |             |
| 2   | Cliente HTTP en el frontend (`apps/web/lib/api.ts`) con token y manejo de errores 401/422          | web         | —          |             |
| 3   | Pantalla de inicio de sesión (usa `/v1/auth/dev/session` en desarrollo) y cerrar sesión            | auth        | 2          |             |
| 4   | Encabezado con usuario y empresa reales desde `GET /v1/me`                                         | web         | 3          |             |
| 5   | Terceros: listado con búsqueda + guardar `PartyForm` en `POST /v1/parties`                         | terceros    | 2          |             |
| 6   | Productos: pantalla de catálogo, crear, editar y desactivar (+ rutas PUT/PATCH en API)             | productos   | 2          |             |
| 7   | Factura: buscador de cliente/producto y "Guardar borrador" → `POST /v1/invoices`                   | facturación | 5, 6       |             |
| 8   | Factura: listado y botón "Emitir" → `POST /v1/invoices/:id/issue`                                  | facturación | 7          |             |
| 9   | Documento soporte: guardar, listar y contabilizar                                                  | doc-soporte | 5          |             |
| 10  | Calendario conectado a `GET/POST /v1/calendar-events`                                              | calendario  | 2          |             |
| 11  | Notificaciones reales (popover y página)                                                           | web         | 2          |             |
| 12  | Resumen con métricas reales (facturado, por cobrar, estados DIAN)                                  | resumen     | 8          |             |
| 13  | Dividir `apps/api/src/server.ts` en `src/routes/<modulo>.ts`                                       | api         | —          |             |
| 14  | Validar existencia de la factura ANTES de llamar al proveedor DIAN (ver comentario en `server.ts`) | api         | 13         |             |
| 15  | Decidir si las notificaciones son por usuario o por organización                                   | api         | —          |             |
| 16  | Usar solo migraciones Prisma (`migrate dev`/`deploy`) en vez de `db push`; actualizar README       | base-datos  | —          |             |
| 17  | Pruebas de integración de endpoints (terceros, facturas)                                           | api         | 13         |             |
| 18  | Agregar ESLint y `format:check` al CI                                                              | config      | —          |             |

> Para evitar conflictos al empezar: una persona toma **13–17 (API)** y la otra **1–5 (web)**;
> luego cada uno toma módulos completos (6, 9, 10…).
