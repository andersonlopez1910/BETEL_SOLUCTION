# Compras y gastos

Módulo del menú lateral **Compras y gastos** (`/compras`), que reemplaza la entrada "Documento soporte". Registra lo
que la empresa compra o paga a sus proveedores y lo contabiliza al guardar.

## Estado por submenú

| Submenú                        | Ruta                                 | Estado                                                                         |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------ |
| Documentos de compras y gastos | `/compras?tab=documentos`            | Funcional: lista, filtros, descarga, registrar, ver, anular y contabilizar.    |
| Registro de eventos            | `/compras?tab=eventos`               | Pendiente (tarea 34). Muestra el aviso "en desarrollo", sin cifras ni botones. |
| Proveedores                    | `/compras?tab=proveedores`           | Pendiente (tarea 35). Muestra el aviso "en desarrollo".                        |
| Soporte por legalizar          | `/compras?tab=soporte-por-legalizar` | Pendiente (tarea 36). Muestra el aviso "en desarrollo".                        |

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

## Permisos

| Acción                                              | Roles                          |
| --------------------------------------------------- | ------------------------------ |
| Consultar lista y documentos                        | Los del Reporte de facturación |
| Descargar                                           | OWNER, ADMIN, ACCOUNTANT       |
| Registrar, anular, contabilizar, buscar proveedores | OWNER, ADMIN, ACCOUNTANT       |

Todo se valida en la API; la interfaz solo desactiva los botones. Cada cambio deja registro en `AuditLog`.

## API

| Método y ruta                                | Uso                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `GET /v1/reports/purchases/documents`        | Lista (from, to, type, supplier, supplierInvoice, page, pageSize)   |
| `GET /v1/reports/purchases/documents/export` | Descarga (413 por encima de 5.000 filas)                            |
| `GET /v1/purchases/suppliers?search=`        | Proveedores activos para el formulario                              |
| `GET /v1/purchases/document?kind=Purchase    | Support&id=`                                                        | Detalle |
| `POST /v1/purchases`                         | Registra compra o gasto (409 si la factura del proveedor se repite) |
| `POST /v1/purchases/:id/void`                | Anula con motivo y asiento inverso                                  |

Tablas `PurchaseDocument` y `PurchaseLine` con RLS (migración `20261120000000_add_purchase_documents`).

## Limitaciones

- **Sucursal** se muestra vacía: Betel aún no maneja sucursales (tarea 30).
- **Estado envío de correo** es "No aplica": los documentos de compra no se envían por correo.
- No se registran pagos parciales a proveedores ni cuentas por pagar por proveedor (submenú Proveedores, tarea 35).
- La compra no mueve existencias de inventario; solo el asiento contable.
- Retenciones en la fuente (retefuente, reteIVA, reteICA) aún no se calculan.

## Pruebas

- Unitarias: `apps/api/test/purchases.test.ts` (numeración, asientos, fuentes de la lista, validaciones).
- Caso de aceptación HT-19 en `docs/human-test.md`.
