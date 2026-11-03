# Historial de cambios

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto sigue versionado semántico.

## [Sin publicar]

### Agregado

- Módulo **Reporte de facturación** (`/reportes/facturacion`) con nueve pestañas. Ventas y Clientes con datos reales:
  filtros, indicadores, gráficas, paginación y exportación a PDF, XLSX y CSV; permisos por rol en la API y
  auditoría de exportaciones. Las demás pestañas indican que su módulo de origen aún no existe
  (ver `docs/reporte-facturacion.md`).
- Cabecera del Reporte de facturación con "Crear factura" y el menú "Remisión y cotización" (sus opciones quedan
  deshabilitadas hasta que existan esos módulos). `AppShell` acepta botones de página en la prop `actions`.
- Cliente HTTP del frontend (`apps/web/lib/api.ts`), con sesión de desarrollo provisional.
- Índice `Invoice(organizationId, customerId, issueDate)` para el reporte por cliente.
- Tareas de VS Code (`.vscode/tasks.json`): iniciar todo al abrir la carpeta, verificar, base de datos, Prisma Studio.
- Configuraciones de depuración (`.vscode/launch.json`) para API, web y pruebas.
- `scripts/instalar-windows.ps1` (instalación completa del entorno) y `scripts/iniciar-base-datos.ps1`.

- Flujo de ramas, revisión mediante Pull Request y validación automática para el trabajo colaborativo.
- Configuración compartida de VS Code, EditorConfig, Prettier (`pnpm format`) y `.gitattributes`.
- Comentarios de documentación en API, contratos, cliente de base de datos, esquema Prisma y frontend.
- Tablero de tareas inicial (`docs/TAREAS.md`) y plantillas de Issues.
- Estándar de comentarios en `CONTRIBUTING.md`.

### Cambiado

- Los artefactos de compilación (`out/`, `apps/web/out/`) dejan de versionarse.
- Dependencias que estaban en `latest` quedan con versión fija.
- El ítem "Facturación" del menú lateral pasa a llamarse "Ventas" (la ruta no cambia).
- "Configuración" sale del menú lateral y pasa a un menú desplegable en el engranaje de la barra superior.
- Los desplegables de la barra superior (notificaciones, ajustes, perfil) se animan al abrir y cerrar, se cierran con clic fuera o Escape, y solo uno puede estar abierto a la vez.

## [0.1.0] - 2026-10-26

### Agregado

- Primera entrega de Betel Solution: facturación, terceros, documentos soporte, calendario, notificaciones y contabilidad base.
