# Compras y gastos

Módulo del menú lateral **Compras y gastos** (`/compras`), que reemplaza la entrada "Documento soporte". Registra lo
que la empresa compra o paga a sus proveedores y lo contabiliza al guardar.

## Estado por submenú

| Submenú                        | Ruta                                 | Estado                                                                                              |
| ------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Documentos de compras y gastos | `/compras?tab=documentos`            | Funcional: lista, filtros, descarga, registrar, ver, anular y contabilizar.                         |
| Registro de eventos            | `/compras?tab=eventos`               | Funcional: registrar facturas por CUFE y enviar los eventos 030, 032, 033 y 031.                    |
| Proveedores                    | `/compras?tab=proveedores`           | Funcional: cuentas por pagar por proveedor, antigüedad, cuentas por pagar y comprobantes de egreso. |
| Soporte por legalizar          | `/compras?tab=soporte-por-legalizar` | Pendiente (tarea 36). Muestra el aviso "en desarrollo".                                             |

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

## Proveedores (cuentas por pagar)

Espejo de la cartera de clientes (Reporte de facturación › Clientes), del lado de lo que se debe a los proveedores.

| Columna          | Definición                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Saldo vencido    | Saldo de las compras y gastos **a crédito** vigentes con vencimiento anterior a hoy (hora de Colombia) |
| Saldo por vencer | Saldo del resto de compras y gastos a crédito vigentes                                                 |
| Saldo a favor    | Anticipos a proveedores: Betel aún no los registra, siempre 0                                          |
| Total saldo      | Vencido + por vencer − a favor                                                                         |
| Estado           | Activo o Inactivo (`Party.active`)                                                                     |

- **Saldo de un documento** = total − pagos de comprobantes de egreso activos. Las compras y gastos de contado y
  los documentos soporte se pagan al registrarse: no generan saldo.
- **Lista:** búsqueda por nombre o identificación; "Más filtros" con saldo de proveedor (todos, con saldo, con
  saldo vencido, sin saldo) y estado (activo por defecto, como la referencia) en etiquetas; columnas visibles
  (se recuerdan en el navegador); descarga PDF/XLSX/CSV con totales; 50 ítems por página.
- **Ver reportes:** Actualizar, **Antigüedad de cuentas por pagar** (saldo por proveedor en tramos: por vencer,
  1–30, 31–60, 61–90 y más de 90 días de vencido, con totales) y Registrar pago a proveedor.
- **Crear Proveedor:** botón dividido con "Crear proveedor que también es cliente" y el formulario completo de
  terceros.
- **Por fila:** "Ver cuentas por pagar" (`/compras/proveedor`) y en el menú: registrar pago, registrar compra o
  gasto, activar o desactivar.

### Cuentas por pagar de un proveedor (`/compras/proveedor?id=`)

Saldos, compras y gastos pendientes (total, pagado, saldo, vencida con días) y comprobantes de egreso de los
últimos 12 meses con los documentos que pagó cada uno. Se imprime (Imprimir / PDF), se registra un pago y se anula
un pago con motivo.

### Comprobante de egreso (`/compras/pago/nuevo?proveedor=`)

Pago a un proveedor que abona a una o varias compras o gastos a crédito ("Pagar saldo" llena el saldo).

- Consecutivo **CE-n** por organización. Fecha no futura. Medios: efectivo, transferencia, tarjeta, cheque u otro.
- No puede pagar más que el saldo de cada documento; la API lo vuelve a validar bloqueando los documentos.
- Asiento: Débito 220505 Proveedores / Crédito 110505 Caja (efectivo) o 111005 Bancos (otros medios).
- Anular: el saldo vuelve a los documentos y se registra el asiento inverso `CE-n-A`.
- Una compra o gasto con pagos vigentes no se puede anular: primero se anulan sus comprobantes de egreso.
- El **tablero principal** suma los comprobantes de egreso activos del mes a las salidas de caja.

## Permisos

| Acción                                                                   | Roles                          |
| ------------------------------------------------------------------------ | ------------------------------ |
| Consultar lista y documentos                                             | Los del Reporte de facturación |
| Descargar                                                                | OWNER, ADMIN, ACCOUNTANT       |
| Registrar, anular, contabilizar, buscar proveedores                      | OWNER, ADMIN, ACCOUNTANT       |
| Registrar facturas recibidas y sus eventos                               | OWNER, ADMIN, ACCOUNTANT       |
| Registrar y anular pagos a proveedores, activar o desactivar proveedores | OWNER, ADMIN, ACCOUNTANT       |

Todo se valida en la API; la interfaz solo desactiva los botones. Cada cambio deja registro en `AuditLog`.

## API

| Método y ruta                                             | Uso                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /v1/reports/purchases/documents`                     | Lista (from, to, type, supplier, supplierInvoice, page, pageSize)                               |
| `GET /v1/reports/purchases/documents/export`              | Descarga (413 por encima de 5.000 filas)                                                        |
| `GET /v1/purchases/suppliers?search=`                     | Proveedores activos para el formulario                                                          |
| `GET /v1/purchases/document?kind=&id=`                    | Detalle de una compra o gasto (kind=Purchase) o de un documento soporte (kind=Support)          |
| `POST /v1/purchases`                                      | Registra compra o gasto (409 si la factura del proveedor se repite)                             |
| `POST /v1/purchases/:id/void`                             | Anula con motivo y asiento inverso (409 si tiene pagos vigentes)                                |
| `GET /v1/reports/purchases/suppliers`                     | Proveedores: saldos por proveedor (search, balance, status, page, pageSize)                     |
| `GET /v1/reports/purchases/suppliers/export`              | Descarga de proveedores                                                                         |
| `GET /v1/reports/purchases/suppliers/aging`               | Antigüedad de cuentas por pagar                                                                 |
| `GET /v1/suppliers/:id/statement`                         | Cuentas por pagar de un proveedor                                                               |
| `POST /v1/suppliers/:id/active`                           | Activar o desactivar proveedor                                                                  |
| `GET /v1/supplier-payments/pending-suppliers`             | Proveedores con saldo por pagar                                                                 |
| `GET /v1/supplier-payments/pending-documents?supplierId=` | Compras y gastos con saldo de un proveedor                                                      |
| `POST /v1/supplier-payments`                              | Registrar comprobante de egreso (422 si supera el saldo)                                        |
| `POST /v1/supplier-payments/:id/void`                     | Anular comprobante de egreso con motivo y asiento inverso                                       |
| `GET /v1/reports/purchases/events`                        | Registro de eventos (status, cufe, from, to, supplier, number, sort, direction, page, pageSize) |
| `GET /v1/purchases/received-invoices/:id`                 | Detalle con historial de eventos                                                                |
| `POST /v1/purchases/received-invoices`                    | Registrar nueva factura (409 si el CUFE ya existe)                                              |
| `POST /v1/purchases/received-invoices/:id/events`         | Registrar evento 030, 032, 033 o 031 (409 si no corresponde)                                    |

Tablas `PurchaseDocument` y `PurchaseLine` con RLS (migración `20261120000000_add_purchase_documents`). Tablas `ReceivedInvoice` y `ReceivedInvoiceEvent` con RLS (migración `20261121000000_add_received_invoice_events`). Tablas `SupplierPayment` y `SupplierPaymentApplication` con RLS (migración `20261122000000_add_supplier_payments`).

## Limitaciones

- **Sucursal** se muestra vacía: Betel aún no maneja sucursales (tarea 30).
- **Estado envío de correo** es "No aplica": los documentos de compra no se envían por correo.
- **Proveedores:** "Saldo a favor" siempre es 0 (no se registran anticipos a proveedores, tarea 35); el comprobante de
  egreso no tiene vista imprimible propia (se imprime el estado de cuentas por pagar) ni se envía por correo.
- La compra no mueve existencias de inventario; solo el asiento contable.
- Retenciones en la fuente (retefuente, reteIVA, reteICA) aún no se calculan.

- **Registro de eventos:** Betel no consulta la DIAN por el CUFE (los datos de la factura se escriben a mano) ni
  transmite los eventos mientras use el proveedor DIAN de pruebas; tampoco recibe el XML ni la representación gráfica.
  Los festivos se calculan por ley; un festivo nuevo decretado por fuera de la Ley 51 no se tendría en cuenta.

## Pruebas

- Unitarias: `apps/api/test/purchases.test.ts` (numeración, asientos, fuentes de la lista, validaciones).
- Unitarias: `apps/api/test/received-invoices.test.ts` (festivos, días hábiles, orden de eventos, validaciones).
- Unitarias: `apps/api/test/payables.test.ts` (antigüedad, validación de saldos, validaciones).
- Casos de aceptación HT-19, HT-20 y HT-21 en `docs/human-test.md`.
