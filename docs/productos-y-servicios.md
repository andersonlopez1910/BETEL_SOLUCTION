# Productos y servicios

Módulo del menú lateral **Productos y servicios** (`/productos`): catálogo de lo que la empresa compra y vende, con
precios, impuestos y stock. Los productos activos son los que ofrecen los editores de ítems de facturas,
cotizaciones, remisiones, facturas recurrentes y compras.

## Estado por submenú

| Submenú                             | Ruta                        | Estado                                                                 |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| Gestión de productos / servicios    | `/productos?tab=gestion`    | Funcional: lista, filtros, crear, editar, importar, activar, eliminar. |
| Documentos de productos / servicios | `/productos?tab=documentos` | Pendiente (tarea 38). Muestra el aviso "en desarrollo".                |
| Costeo mensual                      | `/productos?tab=costeo`     | Pendiente (tarea 39). Muestra el aviso "en desarrollo".                |

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

- Entradas: cantidades de las **compras** vigentes (Compras y gastos, tipo Compra) que usan el producto. Los gastos no
  suman inventario.
- Salidas: cantidades de las **facturas de venta** emitidas, aceptadas o vencidas que usan el producto. Los borradores
  y las facturas anuladas no cuentan.
- Puede quedar negativo si se vendió más de lo que se registró como comprado (igual que en la referencia).

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

## Permisos

| Acción                                         | Roles                           |
| ---------------------------------------------- | ------------------------------- |
| Consultar lista y reportes                     | Los del Reporte de facturación  |
| Descargar                                      | OWNER, ADMIN, ACCOUNTANT        |
| Crear, editar, duplicar, importar, (in)activar | OWNER, ADMIN, ACCOUNTANT, SALES |
| Eliminar                                       | OWNER, ADMIN, ACCOUNTANT        |

Todo se valida en la API; cada cambio deja registro en `AuditLog` (incluido el valor anterior al editar).

## API

| Método y ruta                     | Uso                                                           |
| --------------------------------- | ------------------------------------------------------------- |
| `GET /v1/products`                | Catálogo activo (máx. 100) para los editores de ítems         |
| `POST /v1/products`               | Crear (409 si el código existe)                               |
| `PUT /v1/products/:id`            | Editar                                                        |
| `POST /v1/products/:id/active`    | Activar o inactivar                                           |
| `POST /v1/products/bulk-active`   | Activar o inactivar varios (`ids`, `active`)                  |
| `DELETE /v1/products/:id`         | Eliminar (409 si algún documento lo usa)                      |
| `POST /v1/products/import`        | Importar filas leídas de Excel o CSV (máx. 2.000)             |
| `GET /v1/reports/products`        | Lista con stock (search, kind, status, stock, page, pageSize) |
| `GET /v1/reports/products/export` | Descarga                                                      |
| `GET /v1/reports/products/top`    | Más vendidos (from, to)                                       |

Código en `apps/api/src/products.ts` y `apps/web/components/products.tsx`.

## Limitaciones

- No hay **saldo inicial ni ajustes de inventario**: el stock parte de cero y solo lo mueven compras y facturas
  (tarea 38). Las remisiones no descuentan hasta facturarse; las notas crédito aún no devuelven stock.
- Un solo precio de venta por producto (sin listas de precios) y solo IVA (sin INC ni otros impuestos).
- No hay bodegas ni costo promedio (Costeo mensual, tarea 39).

## Pruebas

- Unitarias: `apps/api/test/products.test.ts` (código automático, estado del stock, lectura de filas de Excel/CSV).
- Caso de aceptación HT-23 en `docs/human-test.md`.
