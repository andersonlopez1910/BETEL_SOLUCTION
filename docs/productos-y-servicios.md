# Productos y servicios

Módulo del menú lateral **Productos y servicios** (`/productos`): catálogo de lo que la empresa compra y vende, con
precios, impuestos y stock. Los productos activos son los que ofrecen los editores de ítems de facturas,
cotizaciones, remisiones, facturas recurrentes y compras.

## Estado por submenú

| Submenú                             | Ruta                        | Estado                                                                      |
| ----------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| Gestión de productos / servicios    | `/productos?tab=gestion`    | Funcional: lista, filtros, crear, editar, importar, activar, eliminar.      |
| Documentos de productos / servicios | `/productos?tab=documentos` | Funcional: saldo inicial y ajustes de inventario (crear, importar, anular). |
| Costeo mensual                      | `/productos?tab=costeo`     | Pendiente (tarea 39). Muestra el aviso "en desarrollo".                     |

## Gestión de productos / servicios

Columnas de la referencia: Tipo, Nombre, Código, Unidad, Precios, Impuestos, Stock, Estado y Acciones, con casillas
de selección y 10 filas por página.

| Columna   | Definición                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------- |
| Código    | Libre y único por organización; si se deja vacío se asigna el siguiente `C-n`                      |
| Precios   | Precio de venta sin IVA; "⋯" abre el detalle con el precio con IVA                                 |
| Impuestos | IVA del producto (19 %, 5 % o 0 % / exento)                                                        |
| Stock     | Solo productos: **entradas − salidas**. Punto rojo = negativo, naranja = cero, turquesa = positivo |
| Estado    | Activo o Inactivo. Un inactivo no se ofrece al crear documentos; su historial se conserva          |

**Cálculo del stock** (sin tabla de inventario; se calcula de los documentos):

- Entradas: cantidades de las **compras** vigentes (Compras y gastos, tipo Compra) que usan el producto, y las entradas
  de **saldo inicial** y **ajustes de inventario** vigentes. Los gastos no suman inventario.
- Salidas: cantidades de las **facturas de venta** emitidas, aceptadas o vencidas que usan el producto, y las salidas de
  los ajustes de inventario vigentes. Los borradores y los documentos anulados no cuentan.
- Puede quedar negativo si se vendió más de lo que se registró como entrada (igual que en la referencia).

**Acciones:**

- **Buscar** por nombre, código o descripción. **Filtros:** tipo, estado y stock (negativo, en cero, positivo), con
  etiquetas que se quitan con ×.
- **Descargar** en Excel (ícono) con los filtros aplicados.
- **Ver reportes:** Productos más vendidos (cantidad y ventas con IVA de las facturas emitidas en un período) y
  Productos con stock negativo.
- **Crear / Importar:** crear producto, crear servicio, o importar desde Excel (.xlsx) o CSV (coma o punto y coma).
  Encabezados en español o inglés: Nombre (obligatorio), Código, Tipo, Unidad, Precio (sin IVA), IVA, Descripción.
  Acepta precios como `5.500`, `1.234,56` o `1,234.50`. Sin código se asigna el siguiente `C-n`; los códigos que ya
  existen y las filas inválidas se informan por número de fila y no se importan. Hay una plantilla descargable.
- **Por fila:** Editar; en el menú, Ver detalle, Duplicar, Activar/Inactivar y Eliminar.
- **Selección:** activar o inactivar varios a la vez.
- **Eliminar** solo si ningún documento (factura, cotización, remisión, factura recurrente o compra) usa el producto;
  si tiene historial, se inactiva. Un producto con compras o ventas no se puede convertir en servicio.

## Documentos de productos / servicios (inventario)

Documentos que mueven el inventario sin ser compras ni ventas. Columnas de la referencia: Tipo transacción,
Comprobante, Fecha elaboración, Identificación, Sucursal, Tercero, Total y Moneda.

| Documento            | Comprobante | Movimientos                                   | Asiento contable                                                         |
| -------------------- | ----------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Saldo inicial        | `SI-n`      | Solo entradas; una vez por producto (vigente) | Débito 143505 Inventario / Crédito 370505 Utilidades acumuladas          |
| Ajuste de inventario | `AJ-n`      | Entradas (sobrantes) y salidas (faltantes)    | Entrada: 143505 / 429595 Otros ingresos · Salida: 519595 Gastos / 143505 |

- Cada renglón: producto (solo productos activos; los servicios no manejan inventario), cantidad y **costo unitario**;
  valor = cantidad × costo. **Total** del documento = entradas − salidas.
- Tercero opcional (responsable o bodega externa) y observaciones. Fecha de elaboración no futura.
- **Nuevo documento** (`/productos/documentos/nuevo?tipo=ADJUSTMENT|INITIAL`): buscador de productos por nombre o
  código y de terceros por nombre o identificación.
- **Importar** saldo inicial o ajuste desde Excel o CSV: encabezados Código (del producto), Cantidad, Costo unitario y,
  en ajustes, Movimiento (Entrada/Salida; una cantidad negativa también es salida). Es **todo o nada**: si alguna
  fila tiene error (código inexistente, servicio, inactivo, repetido, cantidad o costo inválidos) no se crea el
  documento y se listan las filas a corregir. Plantillas descargables.
- **Lista:** búsqueda por tercero o comprobante (`AJ-2`), "Más filtros" (fecha de elaboración —últimos 30 días por
  defecto, como la referencia—, tipo y estado) con etiquetas, descarga PDF/XLSX/CSV, 50 ítems por página.
- **Ver documento** (`/productos/documentos/ver`): renglones, entradas, salidas y total; imprimir y **anular** con
  motivo (asiento inverso `<n>-A`; el stock vuelve). Al anular un saldo inicial se puede registrar otro.
- Los documentos vigentes suman o restan en el **stock** de Gestión de productos.

## Permisos

| Acción                                            | Roles                           |
| ------------------------------------------------- | ------------------------------- |
| Consultar lista y reportes                        | Los del Reporte de facturación  |
| Descargar                                         | OWNER, ADMIN, ACCOUNTANT        |
| Crear, editar, duplicar, importar, (in)activar    | OWNER, ADMIN, ACCOUNTANT, SALES |
| Eliminar                                          | OWNER, ADMIN, ACCOUNTANT        |
| Crear, importar y anular documentos de inventario | OWNER, ADMIN, ACCOUNTANT        |

Todo se valida en la API; cada cambio deja registro en `AuditLog` (incluido el valor anterior al editar).

## API

| Método y ruta                                | Uso                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /v1/products`                           | Catálogo activo (máx. 100; `search`, `kind`) para los formularios           |
| `POST /v1/products`                          | Crear (409 si el código existe)                                             |
| `PUT /v1/products/:id`                       | Editar                                                                      |
| `POST /v1/products/:id/active`               | Activar o inactivar                                                         |
| `POST /v1/products/bulk-active`              | Activar o inactivar varios (`ids`, `active`)                                |
| `DELETE /v1/products/:id`                    | Eliminar (409 si algún documento lo usa)                                    |
| `POST /v1/products/import`                   | Importar filas leídas de Excel o CSV (máx. 2.000)                           |
| `GET /v1/reports/products`                   | Lista con stock (search, kind, status, stock, page, pageSize)               |
| `GET /v1/reports/products/export`            | Descarga                                                                    |
| `GET /v1/reports/products/top`               | Más vendidos (from, to)                                                     |
| `GET /v1/reports/inventory-documents`        | Documentos de inventario (search, type, status, from, to, page, pageSize)   |
| `GET /v1/reports/inventory-documents/export` | Descarga                                                                    |
| `GET /v1/inventory-documents/:id`            | Detalle con renglones, entradas y salidas                                   |
| `POST /v1/inventory-documents`               | Crear saldo inicial o ajuste (409 si el producto ya tiene saldo inicial)    |
| `POST /v1/inventory-documents/import`        | Importar desde filas de Excel o CSV (todo o nada; 422 con errores por fila) |
| `POST /v1/inventory-documents/:id/void`      | Anular con motivo y asiento inverso                                         |
| `GET /v1/parties?search=`                    | Terceros por nombre o identificación (máx. 50)                              |

Código en `apps/api/src/products.ts`, `apps/api/src/inventory.ts`, `apps/web/components/products.tsx` y
`apps/web/components/product-documents.tsx`. Tablas `InventoryDocument` e `InventoryLine` con RLS (migración
`20261124000000_add_inventory_documents`).

## Limitaciones

- Las remisiones no descuentan hasta facturarse y las notas crédito aún no devuelven stock (tarea 38).
- No hay traslados entre bodegas ni documentos de producción: Betel aún no maneja bodegas (tarea 39).
- Los costos de los ajustes los digita el usuario; el costo promedio llegará con Costeo mensual (tarea 39).
- Un solo precio de venta por producto (sin listas de precios) y solo IVA (sin INC ni otros impuestos).
- No hay bodegas ni costo promedio (Costeo mensual, tarea 39).

## Pruebas

- Unitarias: `apps/api/test/products.test.ts` (código automático, estado del stock, lectura de filas de Excel/CSV).
- Unitarias: `apps/api/test/inventory.test.ts` (numeración, valores, asientos, números en Excel, filas, validaciones).
- Casos de aceptación HT-23 y HT-24 en `docs/human-test.md`.
