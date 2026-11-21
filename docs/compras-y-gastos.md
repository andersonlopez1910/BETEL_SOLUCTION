# Compras y gastos

Módulo del menú lateral **Compras y gastos** (`/compras`), que reemplaza la entrada "Documento soporte". Registra lo
que la empresa compra o paga a sus proveedores y lo contabiliza al guardar.

## Estado por submenú

| Submenú                        | Ruta                                 | Estado                                                                           |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------- |
| Documentos de compras y gastos | `/compras?tab=documentos`            | Funcional: lista, filtros, descarga, registrar, ver, anular y contabilizar.      |
| Registro de eventos            | `/compras?tab=eventos`               | Funcional: registrar facturas por CUFE y enviar los eventos 030, 032, 033 y 031. |
| Proveedores                    | `/compras?tab=proveedores`           | Pendiente (tarea 35). Muestra el aviso "en desarrollo".                          |
| Soporte por legalizar          | `/compras?tab=soporte-por-legalizar` | Pendiente (tarea 36). Muestra el aviso "en desarrollo".                          |

## Documentos de compras y gastos

Una sola lista con tres tipos de transacción:

| Tipo              | Origen                               | Comprobante            | Envío a la DIAN                                                           |
| ----------------- | ------------------------------------ | ---------------------- | ------------------------------------------------------------------------- |
| Compra            | `PurchaseDocument` tipo `PURCHASE`   | `CG-n`                 | No aplica (la factura es del proveedor)                                   |
| Gasto             | `PurchaseDocument` tipo `EXPENSE`    | `CG-n`                 | No aplica                                                                 |
| Documento soporte | `SupportDocument` (módulo existente) | `DS-n` o "Sin numerar" | Estado DIAN del documento soporte; "Sin contabilizar" si está en borrador |

- **Filtros:** tipo de transacción; en "Más filtros", fecha de elaboración (por defecto últimos 15 días, como la
  referencia), proveedor (nombre o identificación) y factura del proveedor. Los filtros aplicados se muestran como
  etiquetas que se quitan con ×; "Limpiar filtros" deja todo el período.
- **Descargar:** PDF, XLSX o CSV con encabezado, filtros y totales (máximo 5.000 filas, igual que los reportes).
- **Nueva Compra / Gasto / Doc Soporte:** botón dividido; el menú abre el formulario con el tipo elegido.
- **Acciones por fila:** Ver documento; Anular (compras y gastos); Contabilizar (documento soporte en borrador).
- **Paginación:** 10, 25, 50 (por defecto) o 100 ítems por página.

### Registrar (`/compras/nuevo?tipo=PURCHASE|EXPENSE|SUPPORT`)

- Proveedor: buscador sobre terceros marcados como proveedor y activos; "Crear proveedor" lo crea sin salir.
- Compra o gasto: factura del proveedor (no se puede repetir para el mismo proveedor), fecha, forma de pago y
  vencimiento si es a crédito, observaciones e ítems (con descuento e IVA).
- Documento soporte: ítems sin descuento; "Contabilizar al guardar" lo emite de una vez (sin marcar queda en borrador).

### Contabilización

| Documento | Débito                                              | Crédito                                              |
| --------- | --------------------------------------------------- | ---------------------------------------------------- |
| Compra    | 143505 Inventario de mercancías (neto) + 240810 IVA | 110505 Caja (contado) o 220505 Proveedores (crédito) |
| Gasto     | 519595 Gastos diversos (neto) + 240810 IVA          | 110505 Caja (contado) o 220505 Proveedores (crédito) |
| Anulación | Asiento inverso con referencia `CG-n-A`             |                                                      |

El **tablero principal** suma como gasto los gastos vigentes (sin IVA) y los documentos soporte; la compra de
inventario no es gasto. Las salidas de caja suman documentos soporte y compras o gastos de contado.

## Registro de eventos en factura electrónica de proveedores

Para que una factura electrónica de venta a crédito recibida de un proveedor sirva como soporte de costos,
deducciones o impuestos descontables, el comprador registra su **CUFE** y envía a la DIAN sus eventos
(Res. DIAN 000085 de 2022, art. 34; Decreto 1074 de 2015). Orden obligatorio:

| Paso | Evento DIAN                                | Requisito en Betel                                                            |
| ---- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| 1    | 030 Recepción de factura (acuse de recibo) | Nombre, documento y cargo de quien recibe                                     |
| 2    | 032 Recepción de mercancía o servicio      | Después del 030; nombre, documento y cargo de quien recibe                    |
| 3    | 033 Aceptación expresa **o** 031 Reclamo   | Después del 032 y dentro de **3 días hábiles**; el reclamo exige motivo 01–04 |

- **Plazo:** se cuenta desde el día del 032 sin sábados, domingos ni festivos de Colombia (Ley 51 de 1983,
  incluidos los que dependen de la Pascua). El último día del plazo todavía se puede aceptar o reclamar.
- **Aceptación tácita:** si vence el plazo sin aceptar ni reclamar, la factura pasa a "Eventos finalizados" como
  "Aceptación tácita" (ese evento lo registra el emisor, no el comprador).
- **Pestañas:** "Eventos en proceso" (sin aceptar, reclamar ni plazo vencido) y "Eventos finalizados", con su conteo.
- **Registrar nueva factura:** CUFE (96 caracteres hexadecimales; se guarda en minúsculas, único por organización),
  NIT y nombre del proveedor (si el NIT ya es un proveedor en Terceros se propone su nombre y se enlaza),
  comprobante, fecha de emisión (no futura) y valor opcional. Puede registrar enseguida el 030.
- **Lista:** buscar por CUFE, filtros por fecha de registro, proveedor (nombre o NIT) y comprobante; ordenar por
  cualquier columna; 10, 25 o 50 por página. Cada celda de evento muestra fecha, hora y estado DIAN, o el botón
  para registrar el siguiente. Acciones: ver detalle con el historial, registrar cada evento (deshabilitado con el
  motivo cuando no aplica) y copiar el CUFE. "Aprende más" explica los eventos.
- **Transmisión:** los eventos pasan por el puerto DIAN (`apps/api/src/dian.ts`, `submitDocumentEvent`). Con el
  proveedor de pruebas quedan "En cola DIAN" y se permite continuar con el siguiente; con un proveedor real, el
  evento anterior debe estar aceptado por la DIAN.
- **Quién recibe:** el navegador recuerda la última persona que recibió (solo como comodidad, en ese equipo).

## Permisos

| Acción                                              | Roles                          |
| --------------------------------------------------- | ------------------------------ |
| Consultar lista y documentos                        | Los del Reporte de facturación |
| Descargar                                           | OWNER, ADMIN, ACCOUNTANT       |
| Registrar, anular, contabilizar, buscar proveedores | OWNER, ADMIN, ACCOUNTANT       |
| Registrar facturas recibidas y sus eventos          | OWNER, ADMIN, ACCOUNTANT       |

Todo se valida en la API; la interfaz solo desactiva los botones. Cada cambio deja registro en `AuditLog`.

## API

| Método y ruta                                     | Uso                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /v1/reports/purchases/documents`             | Lista (from, to, type, supplier, supplierInvoice, page, pageSize)                               |
| `GET /v1/reports/purchases/documents/export`      | Descarga (413 por encima de 5.000 filas)                                                        |
| `GET /v1/purchases/suppliers?search=`             | Proveedores activos para el formulario                                                          |
| `GET /v1/purchases/document?kind=Purchase         | Support&id=`                                                                                    | Detalle |
| `POST /v1/purchases`                              | Registra compra o gasto (409 si la factura del proveedor se repite)                             |
| `POST /v1/purchases/:id/void`                     | Anula con motivo y asiento inverso                                                              |
| `GET /v1/reports/purchases/events`                | Registro de eventos (status, cufe, from, to, supplier, number, sort, direction, page, pageSize) |
| `GET /v1/purchases/received-invoices/:id`         | Detalle con historial de eventos                                                                |
| `POST /v1/purchases/received-invoices`            | Registrar nueva factura (409 si el CUFE ya existe)                                              |
| `POST /v1/purchases/received-invoices/:id/events` | Registrar evento 030, 032, 033 o 031 (409 si no corresponde)                                    |

Tablas `PurchaseDocument` y `PurchaseLine` con RLS (migración `20261120000000_add_purchase_documents`). Tablas `ReceivedInvoice` y `ReceivedInvoiceEvent` con RLS (migración `20261121000000_add_received_invoice_events`).

## Limitaciones

- **Sucursal** se muestra vacía: Betel aún no maneja sucursales (tarea 30).
- **Estado envío de correo** es "No aplica": los documentos de compra no se envían por correo.
- No se registran pagos parciales a proveedores ni cuentas por pagar por proveedor (submenú Proveedores, tarea 35).
- La compra no mueve existencias de inventario; solo el asiento contable.
- Retenciones en la fuente (retefuente, reteIVA, reteICA) aún no se calculan.

- **Registro de eventos:** Betel no consulta la DIAN por el CUFE (los datos de la factura se escriben a mano) ni
  transmite los eventos mientras use el proveedor DIAN de pruebas; tampoco recibe el XML ni la representación gráfica.
  Los festivos se calculan por ley; un festivo nuevo decretado por fuera de la Ley 51 no se tendría en cuenta.

## Pruebas

- Unitarias: `apps/api/test/purchases.test.ts` (numeración, asientos, fuentes de la lista, validaciones).
- Unitarias: `apps/api/test/received-invoices.test.ts` (festivos, días hábiles, orden de eventos, validaciones).
- Casos de aceptación HT-19 y HT-20 en `docs/human-test.md`.
