# Reporte de facturación

Módulo de consulta en `/reportes/facturacion`, con nueve pestañas en este orden: **Ventas, Recaudos,
Gestión de cobro cartera Betel, Cotizaciones, Remisiones, Facturas recurrentes, Envío masivo, Clientes y
Seguimiento comercial**. La pestaña activa va en la URL (`?tab=ventas`, `?tab=clientes`, …).

## Estado por pestaña

| Pestaña                        | Estado                                | Fuente de datos                                                               |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------- |
| Ventas                         | ✅ Datos reales                       | `Invoice`, `Party`, `AuditLog` (responsable), `User`                          |
| Recaudos                       | ✅ Datos reales                       | `Invoice` (contado), `CashReceipt`, `CashReceiptApplication`, `DocumentEmail` |
| Gestión de cobro cartera Betel | ✅ Datos reales (pasarela de pruebas) | `OnlinePayment`, `CashReceipt`, `Invoice`                                     |
| Cotizaciones                   | ✅ Datos reales                       | `Quote`, `QuoteLine`, `DocumentEmail`                                         |
| Remisiones                     | ✅ Datos reales                       | `Delivery`, `DeliveryLine`, `DocumentEmail`                                   |
| Facturas recurrentes           | ✅ Datos reales                       | `RecurringInvoice`, `RecurringInvoiceLine`, `RecurringInvoiceRun`, `Invoice`  |
| Envío masivo                   | ⛔ Sin fuente de datos                | No existe el módulo. Los envíos individuales ya quedan en `DocumentEmail`     |
| Clientes                       | ✅ Parcial                            | `Party` + `Invoice`. Falta mostrar recaudado y saldo (tarea 25)               |
| Seguimiento comercial          | ⛔ Sin fuente de datos                | No existe el módulo comercial                                                 |

Las pestañas sin fuente muestran ese estado en lugar de cifras inventadas, y no tienen filtros ni
botones. Cuando exista el módulo de origen se agrega su consulta en `apps/api/src/reports.ts` y su
pestaña en `apps/web/components/`, con el mismo patrón de Ventas.

## Definiciones de cálculo

Todas las sumas se hacen en PostgreSQL o con `Prisma.Decimal`, nunca con `Number`, y se devuelven
como texto con 2 decimales (`"404600.60"`). El frontend solo las formatea para mostrarlas.

| Indicador                         | Definición                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Factura vigente**               | Estado `ISSUED`, `ACCEPTED` u `OVERDUE`. Es la base de **todos** los indicadores.                                                                                                            |
| Filas de la tabla                 | Todas las facturas del filtro **excepto borradores**. Las anuladas y rechazadas se listan tachadas.                                                                                          |
| Total de ventas                   | Σ `Invoice.total` de las facturas vigentes del período.                                                                                                                                      |
| Subtotal / Descuentos / Impuestos | Σ de `subtotal`, `discountTotal` y `taxTotal` guardados en cada factura (no se recalculan).                                                                                                  |
| Cantidad de facturas              | Número de facturas vigentes (cada factura cuenta una vez: no hay joins con líneas).                                                                                                          |
| Promedio por factura              | Total de ventas ÷ cantidad de facturas, redondeado a 2 decimales; 0 si no hay facturas.                                                                                                      |
| Ventas por día                    | Agrupación por `issueDate` (es una fecha sin hora). Los días sin ventas se grafican en 0.                                                                                                    |
| Ventas por mes                    | Suma de los totales diarios por año-mes.                                                                                                                                                     |
| Comparación entre períodos        | Período anterior con la misma cantidad de días, terminando el día antes de "Fecha inicial". Variación = (actual − anterior) ÷ anterior × 100, con 1 decimal; "Sin base" si el anterior es 0. |
| Usuario responsable               | Usuario del registro `AuditLog` con `entity = "Invoice"` y `action = "CREATE_DRAFT"` (quien creó la factura). La tabla `Invoice` no guarda autor.                                            |
| Facturas vencidas                 | Facturas con estado `OVERDUE`.                                                                                                                                                               |
| Total facturado por cliente       | Σ `Invoice.total` de las facturas vigentes del cliente en el período.                                                                                                                        |
| Última facturación                | `issueDate` más reciente entre las facturas vigentes del cliente en el período.                                                                                                              |
| Período por defecto               | Del día 1 del mes actual a hoy, en hora de Colombia (`America/Bogota`).                                                                                                                      |

Reglas que se cumplen por construcción: los borradores no son ventas; las anuladas no suman; no se
mezclan valores facturados con recaudados (Ventas suma facturas; Recaudos suma dinero recibido); las cotizaciones y remisiones no existen,
así que tampoco pueden contarse como facturas.

**Notas crédito:** hoy solo existen como tipo en `ElectronicEvent.kind`, no como documento que ajuste
el valor de una factura. Cuando se implementen, el total de ventas debe restarlas (ver tareas).

## Recaudos

Pestaña `?tab=recaudos`, organizada como la referencia: buscador por cliente o identificación,
**Más filtros** (período, documento, medio de pago, estado del correo), **Ver reportes** (actualizar y
exportar), **Crear recibo de caja** (botón dividido; la flecha ofrece la factura de contado), selección
múltiple para **enviar por correo** y, por fila, **Enviar por correo** con su menú (**Ver documento**,
**Enviar a otro correo**, **Anular recibo**).

| Concepto              | Definición                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recaudo**           | Dinero recibido: facturas de **contado** vigentes (se pagan al emitirse) + **recibos de caja activos**. Los recibos anulados se listan tachados y no suman. |
| Factura a crédito     | No es recaudo: genera cartera. Saldo = `total` − Σ valores aplicados por recibos **activos**.                                                               |
| Recibo de caja (RC-n) | Dinero recibido de un cliente, aplicado a una o varias de sus facturas a crédito. Total = Σ aplicaciones. Consecutivo por organización.                     |
| Validación de abonos  | Cada valor > 0, máximo 2 decimales y ≤ saldo de la factura. Las facturas se bloquean (`FOR UPDATE`) para que dos recibos simultáneos no excedan el saldo.   |
| Total recaudado       | Σ facturas de contado del período + Σ recibos activos del período (con los filtros aplicados).                                                              |
| Cartera por cobrar    | Σ saldos de las facturas a crédito vigentes **a hoy** (no depende del período; sí del buscador de cliente).                                                 |
| Correo "Enviado"      | El documento tiene al menos un envío exitoso en `DocumentEmail`. Los fallidos también quedan registrados.                                                   |
| Anulación             | Exige motivo; el saldo vuelve a las facturas y se registra el asiento inverso (`RC-n-A`).                                                                   |

**Contabilidad del recibo:** Débito 110505 Caja (efectivo) o 111005 Bancos (transferencia, tarjeta, cheque,
otro) / Crédito 130505 Clientes. La anulación registra el asiento contrario.

**Correo:** SMTP configurable con `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` y
`SMTP_FROM` (`.env.example`). Sin `SMTP_HOST` la API responde 503 explicando qué falta. En desarrollo,
`docker compose --profile mail up -d` levanta **Mailpit**: recibe los correos sin entregarlos y los muestra
en http://localhost:8025. El correo lleva el detalle del documento en HTML y texto (aún no adjunta PDF).

## Gestión de cobro cartera Betel (pagos en línea)

Pestaña `?tab=gestion-cobro`: cobro de facturas a crédito con **link de pago**. El cliente abre el link
(página pública `/pago?token=…`, sin sesión), paga en la pasarela y, al aprobarse, el pago abona la
factura y aparece en Recaudos como "Recibo de caja · Pago en línea".

**Pasarela:** se conecta con un adaptador (`apps/api/src/payment-provider.ts`, mismo patrón que la DIAN).
Hoy solo existe el de **pruebas** (`PAYMENT_PROVIDER=sandbox`, por defecto fuera de producción): la página
de pago permite simular "aprobado" o "rechazado" y no se mueve dinero; un aviso lo indica en la pestaña y en
la página. En producción sin adaptador real la API responde 503 al generar links. Conectar Wompi, Mercado
Pago o PayU es la tarea 28.

| Concepto            | Definición                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Link de pago (PL-n) | Cobro de una factura a **crédito** con saldo, por todo el saldo o una parte. Consecutivo por organización.                          |
| Total pagado        | Valor del link cuando el pago fue **aprobado**.                                                                                     |
| Comisión            | La calcula el adaptador. Pruebas: 2,99 % + $900, más IVA 19 % sobre la comisión. Un link que no cubre la comisión se rechaza.       |
| Neto recibido       | Total pagado − comisión.                                                                                                            |
| Aprobación          | Revalida el saldo con la factura bloqueada; si cambió, el pago queda **rechazado** y no se aplica. Crea el recibo de caja (ONLINE). |
| Desembolso          | Al aprobarse queda "Por desembolsar"; "Registrar desembolso" lo marca "Desembolsado" cuando el dinero llega al banco.               |
| Total documentos    | Σ valor de los links **no anulados** del período.                                                                                   |
| Total neto recibido | Σ neto de los pagos aprobados del período.                                                                                          |
| Por desembolsar     | Σ neto de los aprobados con desembolso pendiente.                                                                                   |
| Pagos rechazados    | Cantidad de pagos rechazados del período.                                                                                           |

Los indicadores usan el período (fecha de creación del link) y el buscador; su botón **Filtrar** aplica el
estado correspondiente a la tabla. Un recibo de pago en línea no se anula desde Recaudos (sería un reembolso
de la pasarela).

**Contabilidad:** al aprobarse, Débito 138095 Pasarela por desembolsar (neto) + Débito 530515 Comisiones
(comisión) / Crédito 130505 Clientes (total). Al desembolsar, Débito 111005 Bancos / Crédito 138095 (neto).

## Cotizaciones

Pestaña `?tab=cotizaciones`, como la referencia: filtro **Usuario** (quien la elaboró), **Más filtros**
(fecha de elaboración con períodos rápidos o rango, cliente, estado) con contador, etiquetas de filtros
activos que se quitan con ×, **Limpiar filtros**, **Descargar** (PDF, XLSX o CSV; deshabilitado sin
resultados) y **Crear cotización** (`/cotizaciones/nueva`). Columnas: Comprobante, Fecha elaboración,
Identificación, Sucursal, Cliente, Total y Moneda; por fila: ver, enviar por correo (al cliente o a otro
correo), convertir en factura y anular. "Ver cotización" (`/cotizaciones/documento?id=`) es imprimible.

| Concepto             | Definición                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Cotización (COT-n)   | Propuesta de venta. **No es factura, no suma en Ventas ni genera contabilidad.** Consecutivo por organización.             |
| Totales              | Los calcula el servidor con `calculateDocumentTotals`, igual que la factura (el formulario muestra una vista previa).      |
| Estados              | Abierta; **Vencida** = abierta con "Válida hasta" anterior a hoy (se calcula); Facturada; Anulada (con motivo).            |
| Convertir en factura | Crea una **factura en borrador** con las mismas líneas y totales y la marca como facturada. La emisión es aparte (Ventas). |
| Sucursal             | Betel aún no maneja sucursales: la columna se muestra vacía.                                                               |
| Moneda               | La de la organización al crearla (hoy COP).                                                                                |

Permisos: consultan los roles del reporte; crean, envían, convierten y anulan OWNER, ADMIN, ACCOUNTANT y
SALES; descargan OWNER, ADMIN y ACCOUNTANT. Cada acción queda en `AuditLog` (`Quote`); la factura creada
registra `Invoice CREATE_DRAFT`, así que el reporte de Ventas muestra su responsable.

## Remisiones

Pestaña `?tab=remisiones`, como la referencia: buscador **Cliente**, **Más filtros** (fecha de elaboración,
por defecto **últimos 15 días**; usuario; tipo de transacción; estado; estado del envío de correo) con
contador y etiquetas removibles, **Limpiar filtros**, **Descargar** y **Crear remisión** (`/remisiones/nueva`).
Columnas: Tipo transacción, Comprobante, Fecha elaboración, Identificación, Sucursal, Cliente, Estado envío de
correo, Total y Moneda. Por fila: ver, enviar por correo, convertir en factura y anular.

| Concepto               | Definición                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Remisión (REM-n)       | Constancia de mercancía entregada. **No es factura, no suma en Ventas ni genera contabilidad.** Consecutivo por organización. |
| Tipo de transacción    | Venta, Consignación o Muestra.                                                                                                |
| Estados                | Abierta, Facturada (se creó la factura en borrador) y Anulada (con motivo).                                                   |
| Estado envío de correo | "Enviado" si hay al menos un envío exitoso registrado.                                                                        |
| Convertir en factura   | Igual que la cotización: factura en borrador idéntica (`createDraftInvoiceFrom`, compartida por ambos módulos).               |

El formulario, la vista imprimible y el diálogo de conversión son los mismos de Cotizaciones con otra
configuración (`quote-form.tsx`, `quote-document.tsx`, `quote-dialogs.tsx`). Permisos iguales a Cotizaciones.

## Facturas recurrentes

Pestaña `?tab=facturas-recurrentes`, como la referencia: aviso sobre la fecha de elaboración y la DIAN (se
puede cerrar; "Conocer más" lo explica), filtro **Recurrencia**, **Más filtros** (fecha de inicio, por defecto
este mes; estado, por defecto activo; cliente) con etiquetas, **Limpiar filtros**, **Descargar** y **Crear
factura recurrente** (`/facturas-recurrentes/nueva`). Columnas: Factura recurrente, Identificación,
Sucursal, Cliente, Recurrencia, Número de veces ("generadas de límite", ∞ sin límite), Fecha inicio (con la
próxima fecha), **Activo** (interruptor) y Acción (ver, generar ahora, activar o desactivar).

| Concepto                  | Definición                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factura recurrente (FR-n) | Plantilla (cliente, ítems, forma de pago, frecuencia, fecha de inicio y número de veces opcional) que genera una **factura en borrador** por período.    |
| Frecuencias               | Semanal, quincenal, mensual, bimestral, trimestral, semestral y anual. Las mensuales conservan el día de inicio y se ajustan al fin de mes.              |
| Fecha de la factura       | **El día en que se genera**, no la programada: la DIAN exige que la fecha de elaboración sea igual a la de envío.                                        |
| Generación automática     | La API revisa al arrancar y cada hora todas las organizaciones y genera una factura por plantilla activa vencida (`RECURRING_SCHEDULER=false` la apaga). |
| Atrasos                   | No se generan facturas atrasadas en lote (saldrían con la misma fecha): se genera la vencida y se salta a la siguiente fecha futura.                     |
| Número de veces           | Límite de facturas generadas; al alcanzarlo ya no hay próxima fecha.                                                                                     |
| Generar ahora             | Genera ya la factura del período pendiente (con fecha de hoy) y avanza al siguiente.                                                                     |
| Activar / desactivar      | Una inactiva no se genera. Al reactivarla, los períodos que pasaron no se generan: sigue con la primera fecha desde hoy.                                 |
| Crédito                   | La factura vence a los días de plazo indicados en la plantilla, contados desde la fecha de la factura.                                                   |

Las facturas generadas quedan relacionadas en `RecurringInvoiceRun` (la tabla `Invoice` no se modificó) y su
responsable en Ventas es quien la generó a mano o, si fue automática, quien creó la plantilla. Igual que en
Cotizaciones y Remisiones, la emisión DIAN es un paso aparte (tarea 31).

## API

Rutas en `apps/api/src/reports.ts` y `apps/api/src/collections.ts` (Recaudos). Los datos de entrada se
validan con los esquemas de `@betel/contracts` (422 si son inválidos).

| Ruta                                                | Uso                                                        |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `GET /v1/reports/billing/users`                     | Usuarios de la organización (filtro "Usuario responsable") |
| `GET /v1/reports/billing/sales`                     | Filas paginadas + indicadores + series por día y por mes   |
| `GET /v1/reports/billing/sales/export`              | Todas las filas filtradas (máx. 5.000) + indicadores       |
| `GET /v1/reports/billing/customers`                 | Consolidado por cliente, paginado                          |
| `GET /v1/reports/billing/customers/export`          | Todos los clientes filtrados (máx. 5.000)                  |
| `GET /v1/reports/billing/customers/:id`             | Historial de facturas y evolución mensual de un cliente    |
| `GET /v1/reports/billing/collections`               | Recaudos: filas paginadas + indicadores                    |
| `GET /v1/reports/billing/collections/export`        | Todas las filas de Recaudos filtradas (máx. 5.000)         |
| `GET /v1/collections/document`                      | Ver documento (factura o recibo) con historial de correos  |
| `GET /v1/collections/pending-customers`             | Clientes con facturas a crédito por cobrar                 |
| `GET /v1/collections/pending-invoices`              | Facturas a crédito con saldo de un cliente                 |
| `POST /v1/cash-receipts`                            | Crear recibo de caja                                       |
| `POST /v1/cash-receipts/:id/void`                   | Anular recibo de caja (con motivo)                         |
| `POST /v1/documents/email`                          | Enviar factura o recibo por correo                         |
| `GET /v1/reports/billing/online-payments`           | Gestión de cobro: filas paginadas + indicadores            |
| `GET /v1/reports/billing/online-payments/export`    | Todas las filas filtradas (máx. 5.000)                     |
| `GET /v1/online-payments/payable-invoices`          | Facturas a crédito con saldo para generar link             |
| `POST /v1/online-payments`                          | Generar link de pago                                       |
| `POST /v1/online-payments/:id/email`                | Enviar el link por correo                                  |
| `POST /v1/online-payments/:id/cancel`               | Anular un link pendiente                                   |
| `POST /v1/online-payments/:id/disburse`             | Registrar el desembolso de la pasarela                     |
| `GET /v1/public/payments/:token`                    | **Pública:** datos del link para la página de pago         |
| `POST /v1/public/payments/:token/sandbox`           | **Pública, solo pruebas:** simular el resultado del pago   |
| `GET /v1/reports/billing/quotes`                    | Cotizaciones: filas paginadas                              |
| `GET /v1/reports/billing/quotes/export`             | Todas las cotizaciones filtradas (Descargar)               |
| `GET /v1/quotes/customers`                          | Clientes para el formulario                                |
| `GET /v1/quotes/:id`                                | Ver cotización con historial de correos                    |
| `POST /v1/quotes`                                   | Crear cotización                                           |
| `POST /v1/quotes/:id/email`                         | Enviar por correo                                          |
| `POST /v1/quotes/:id/void`                          | Anular (con motivo)                                        |
| `POST /v1/quotes/:id/invoice`                       | Convertir en factura en borrador                           |
| `GET /v1/reports/billing/deliveries`                | Remisiones: filas paginadas                                |
| `GET /v1/reports/billing/deliveries/export`         | Todas las remisiones filtradas (Descargar)                 |
| `GET /v1/deliveries/:id`                            | Ver remisión con historial de correos                      |
| `POST /v1/deliveries`                               | Crear remisión                                             |
| `POST /v1/deliveries/:id/email`                     | Enviar por correo                                          |
| `POST /v1/deliveries/:id/void`                      | Anular (con motivo)                                        |
| `POST /v1/deliveries/:id/invoice`                   | Convertir en factura en borrador                           |
| `GET /v1/reports/billing/recurring-invoices`        | Facturas recurrentes: filas paginadas                      |
| `GET /v1/reports/billing/recurring-invoices/export` | Todas las filas filtradas (Descargar)                      |
| `GET /v1/recurring-invoices/:id`                    | Ver plantilla con las facturas generadas                   |
| `POST /v1/recurring-invoices`                       | Crear factura recurrente                                   |
| `POST /v1/recurring-invoices/:id/active`            | Activar o desactivar                                       |
| `POST /v1/recurring-invoices/:id/generate`          | Generar ya la factura del período pendiente                |

Filtros de Ventas: `from`, `to` (AAAA-MM-DD), `customer` (nombre o identificación), `number` (prefijo o
número), `status`, `userId`, `page`, `pageSize` (máx. 100). Filtros de Clientes: `from`, `to`, `search`,
`page`, `pageSize`. Filtros de Recaudos: `from`, `to`, `search`, `documentType` (`Invoice` o
`CashReceipt`), `method`, `email` (`SENT` o `UNSENT`), `page`, `pageSize`.

### Permisos (validados en el backend)

| Rol                      | Consultar | Exportar | Crear / anular recibos | Enviar por correo |
| ------------------------ | --------- | -------- | ---------------------- | ----------------- |
| OWNER, ADMIN, ACCOUNTANT | ✅        | ✅       | ✅                     | ✅                |
| SALES                    | ✅        | ❌ (403) | ❌ (403)               | ✅                |
| VIEWER                   | ✅        | ❌ (403) | ❌ (403)               | ❌ (403)          |
| SUPPORT                  | ❌ (403)  | ❌ (403) | ❌ (403)               | ❌ (403)          |

Cada exportación queda en `AuditLog` (`entity = "BillingReport"`, `action = "EXPORT"`, con los filtros
y la cantidad de filas). Crear y anular recibos y enviar correos también quedan en `AuditLog`
(`CashReceipt` CREATE/VOID, `EMAIL_SENT`/`EMAIL_FAILED`). Los links de pago siguen a "Enviar por correo":
los generan, envían y anulan OWNER, ADMIN, ACCOUNTANT y SALES; el desembolso solo OWNER, ADMIN y ACCOUNTANT.
Cada paso queda en `AuditLog` (`OnlinePayment`). Los datos se leen con `withOrganizationScope`, así que RLS impide ver
información de otra organización.

### Rendimiento

- Paginación en el servidor; los indicadores se calculan con `aggregate` y `groupBy`, sin traer filas.
- El responsable se resuelve con una sola consulta por página.
- Índices usados: `Invoice(organizationId, status, issueDate)` (existente) y
  `Invoice(organizationId, customerId, issueDate)` (nuevo, migración `20261103000000_add_invoice_customer_report_index`).
- Recaudos combina dos tablas: cada una aporta como máximo `página × tamaño` filas ordenadas por fecha y se
  mezclan en memoria. Para páginas muy profundas convendría una vista SQL con `UNION`.
- El filtro por estado del correo obtiene primero los ids enviados desde `DocumentEmail`.
- Las exportaciones tienen un tope de 5.000 filas (413 si se supera, pidiendo acotar filtros).
- Limitación conocida: el filtro por responsable obtiene primero los ids de facturas desde `AuditLog`.
  Con volúmenes muy grandes conviene guardar `createdById` en `Invoice` (ver tareas).

## Exportación

En el navegador (`apps/web/lib/report-export.ts`), a partir del endpoint `/export`, que respeta los filtros:

- **CSV:** separado por comas, UTF-8 con BOM, decimales con punto.
- **Excel (XLSX):** con exceljs, montos como número con formato `#,##0.00`. La librería se carga solo al exportar.
- **PDF:** documento imprimible en horizontal; se abre el diálogo de impresión del navegador ("Guardar como PDF").

Todas incluyen empresa, nombre del reporte, fecha de generación, período, filtros aplicados, detalle y
totales de facturas vigentes.

## Pruebas

- `apps/api/test/reports.test.ts` (unitarias): períodos y zona horaria, variación, promedio, agrupación
  por mes con `Decimal`, exclusión de borradores y anuladas, validación de filtros.
- Verificación de punta a punta contra la API local, con una organización de prueba (NIT 900999777):
  totales exactos con anuladas, vencidas y borradores mezclados; filtros por estado, cliente,
  responsable y número; paginación; Clientes cuadra con Ventas; registro de exportación en auditoría;
  permisos VIEWER/SUPPORT/anónimo; aislamiento entre organizaciones.
- `apps/api/test/collections.test.ts` (unitarias): suma de abonos con `Decimal`, abono mayor al saldo,
  facturas no pendientes, mezcla y ventana de la paginación, cuenta contable por medio de pago, validación
  del recibo y de los filtros, escape de HTML en el correo.
- Recaudos de punta a punta (organización de prueba NIT 900999778, 42 comprobaciones): borradores y créditos
  no son recaudo, cartera, abonos mayores al saldo o a facturas de contado rechazados, recibo con asiento
  cuadrado, filtros, paginación, correo recibido en Mailpit y a otro destinatario, filtro de correo, ver
  documento, exportación, anulación con asiento inverso y saldo restituido, permisos VIEWER/SALES/anónimo y
  aislamiento entre organizaciones. Los datos de prueba se borran al terminar.
- `apps/api/test/payments.test.ts` (unitarias): comisión de pruebas, neto con `Decimal`, link que no cubre
  la comisión, token del link, validaciones.
- Pagos en línea de punta a punta (37 comprobaciones): solo facturas a crédito con saldo, límites del valor,
  página pública sin sesión, token alterado, envío del link a Mailpit, aprobación con comisión y neto, doble
  pago bloqueado, recibo en Recaudos y cartera, asiento cuadrado, rechazo por saldo cambiado y por la entidad,
  anulación, indicadores y filtros, desembolso con cuenta de pasarela en cero, exportación, permisos
  VIEWER/SALES/anónimo y aislamiento entre organizaciones.
- `apps/api/test/quotes.test.ts` (unitarias): estado vencida, filtros de estado y usuario, validaciones.
- Cotizaciones de punta a punta (36 comprobaciones): totales del servidor con descuento e IVA, filtros por
  estado, usuario y cliente, correo en Mailpit, conversión a factura en borrador con mismas líneas y total y
  su auditoría, conversión única, anulación, descarga, permisos y aislamiento entre organizaciones.
- `apps/api/test/deliveries.test.ts` (unitarias): filtros (cliente, usuario, tipo, estado, correo) y validaciones.
- Remisiones de punta a punta (23 comprobaciones): totales, período de 15 días, filtros, estado del correo
  con Mailpit, conversión a factura a crédito idéntica, anulación, descarga, permisos y aislamiento.
- `apps/api/test/recurring.test.ts` (unitarias): fechas de cada frecuencia con ajuste a fin de mes y año
  bisiesto, avance sin generar atrasos, límite de veces, generación anticipada, reactivación y validaciones.
- Facturas recurrentes de punta a punta (26 comprobaciones), incluida la generación automática real: fecha de
  hoy, crédito a 30 días, no repite el período, responsable, límite de veces, inactivas no se generan,
  reactivación sin atrasos, descarga, permisos y aislamiento.

## Problemas encontrados en el sistema existente

1. **El frontend no estaba conectado a la API** ni tiene inicio de sesión. Este módulo agregó
   `apps/web/lib/api.ts`, que en desarrollo usa `POST /v1/auth/dev/session`. Falta el login real.
2. **La emisión no asigna número a la factura** (`prefix`/`number` quedan vacíos); el reporte muestra
   "Sin numerar".
3. **Descuadre de un centavo en `calculateDocumentTotals`:** redondea con `Number`, así que una línea
   de $50.000,50 con IVA 19 % se guarda con IVA 9.500,09 y total 59.500,60 (subtotal + IVA = 59.500,59).
   El reporte suma los valores guardados, como debe, pero el cálculo de origen debería usar `Decimal`.
4. No existe el estado del cliente (activo/inactivo) en `Party`, por eso no se muestra.
5. **Las facturas de contado no registran la entrada de dinero en contabilidad:** la emisión (módulo Ventas,
   que no se modificó) debita 130505 Clientes también para contado, así que esa cuenta queda con saldo por
   facturas ya pagadas. Recaudos las cuenta como recaudo (son de contado), pero falta el asiento
   Caja/Clientes al emitirlas (tarea 26).
