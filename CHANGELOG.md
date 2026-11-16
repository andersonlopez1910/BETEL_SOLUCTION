# Historial de cambios

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto sigue versionado semántico.

## [Sin publicar]

### Agregado

- **Cotizaciones** en el Reporte de facturación: crear cotización (`/cotizaciones/nueva`), lista con filtro por
  usuario, más filtros con etiquetas, descarga PDF/XLSX/CSV, ver e imprimir, enviar por correo, anular y
  convertir en factura en borrador. Tablas `Quote` y `QuoteLine` con RLS. "Cotización" en el menú
  "Remisión y cotización" abre el formulario.
- **Gestión de cobro cartera Betel** (pagos en línea): links de pago para facturas a crédito, página pública
  `/pago`, comisión y neto recibido, estados del pago y del desembolso, indicadores con "Filtrar", exportación
  y envío del link por correo. Al aprobarse, el pago crea el recibo de caja y el asiento contable. Pasarela
  conectada por adaptador; hoy solo la de pruebas (`PAYMENT_PROVIDER=sandbox`). Tabla `OnlinePayment` con RLS.
- **Recaudos** en el Reporte de facturación: recibos de caja que abonan a facturas a crédito (asiento contable,
  consecutivo RC-n y anulación con asiento inverso) y lista de recaudos (facturas de contado + recibos) con
  buscador, filtros, indicadores, cartera por cobrar, selección múltiple, exportación y "Ver documento"
  imprimible. Pantallas `/recaudos/nuevo` y `/recaudos/documento`; API en `apps/api/src/collections.ts`.
- Envío de facturas y recibos por correo (SMTP configurable con nodemailer) con registro de cada envío
  (columna "Correo": Enviado / Sin enviar). Mailpit en `docker compose --profile mail` para desarrollo.
- Tablas `CashReceipt`, `CashReceiptApplication` y `DocumentEmail` con RLS (migración
  `20261116000000_add_cash_receipts_and_document_emails`); cuentas 110505 Caja y 111005 Bancos.
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
- "Crear factura" del Reporte de facturación pasa a botón dividido: su flecha despliega Factura recurrente, Nota
  crédito y Nota débito (deshabilitadas hasta que existan esos módulos) y Documento de ingreso (recibo de caja).
- "Remisión y cotización" va después de "Crear factura", con el mismo botón dividido en blanco.
- Las pestañas del Reporte de facturación pasan a estilo subrayado (sin cajas ni separadores).
- La pestaña "Gestión Siigo Pay" del Reporte de facturación pasa a llamarse "Gestión de cobro cartera Betel"
  (`?tab=gestion-cobro`).
- "Ventas" sale del menú lateral: la factura nueva se abre con "Crear factura" en el Reporte de facturación
  (o con "＋ Crear" en la barra superior).
- "Configuración" sale del menú lateral y pasa a un menú desplegable en el engranaje de la barra superior.
- Los desplegables de la barra superior (notificaciones, ajustes, perfil) se animan al abrir y cerrar, se cierran con clic fuera o Escape, y solo uno puede estar abierto a la vez.

## [0.1.0] - 2026-10-26

### Agregado

- Primera entrega de Betel Solution: facturación, terceros, documentos soporte, calendario, notificaciones y contabilidad base.
