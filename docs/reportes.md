# Reportes

Menú lateral **Reportes** (`/reportes`). Reúne todos los reportes de Betel con las áreas y secciones de la referencia.
Incluye el **catálogo de reportes**, 45 reportes nuevos sobre los datos reales, y los dos estados financieros
básicos. Los reportes que aún no se pueden generar muestran **En desarrollo** con el motivo, sin enlace.

- Web:
  - centro y estados financieros: `apps/web/components/financial-reports.tsx`;
  - pantalla genérica del catálogo: `apps/web/components/catalog-report.tsx`;
  - páginas: `apps/web/app/(app)/reportes/`.
- API:
  - estados financieros: `apps/api/src/statements.ts`;
  - catálogo: `apps/api/src/catalog/`, con `index.ts` (ruta), `common.ts`, `sales.ts`, `parties.ts`, `inventory.ts`
    y `accounting.ts`.

## Centro de reportes

Hay un buscador por nombre y diez áreas plegables:

- facturación y ventas;
- clientes y proveedores;
- compras y gastos;
- productos y servicios;
- cajas y bancos;
- nómina;
- contabilidad;
- seguimiento comercial (CRM) y de cobranza;
- auditoría;
- reportes de configuración.

Cada renglón puede ser:

- un reporte del catálogo (`/reportes/ver?id=...`);
- un reporte o módulo que ya existía (pestañas del reporte de facturación, compras, costeo, bancos, nómina, balance de
  prueba, libro diario, etc.);
- un reporte **en desarrollo**, con el motivo.

| Área › sección                         | En desarrollo (motivo)                                                      |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Facturación › POS                      | Ventas POS: Betel no tiene punto de venta                                   |
| Facturación › Movimiento de documentos | Notas crédito y débito de venta: Betel aún no las emite                     |
| Compras › Compras y gastos             | Cruce orden de compra vs factura: Betel no maneja órdenes de compra         |
| Compras › Movimiento de documentos     | Notas débito de proveedores: aún no se registran                            |
| Contabilidad › Contables               | Informes personalizados (configurables)                                     |
| Contabilidad › Financieros             | Situación financiera y resultado integral configurables; flujos de efectivo |
| Contabilidad › Activos fijos           | Listado de activos fijos: Betel aún no maneja activos fijos                 |

No se replicó «Versiones anteriores de reportes» de la referencia: son formatos antiguos de reportes que ya están en el
catálogo.

## Catálogo de reportes

Todos los reportes del catálogo comparten una sola pantalla:

- **Filtros** según el reporte: período, fecha de corte, año, búsqueda, clientes o proveedores, cuenta o producto.
- **Tabla** con totales de las columnas numéricas y notas que explican el cálculo.
- **Descarga** en PDF, Excel y CSV.

Definiciones comunes:

- **Ventas:** facturas emitidas vigentes, por fecha de emisión.
- **Base:** valor antes de IVA y después de descuentos.
- **Vendedor:** el usuario que creó la factura, el mismo «usuario responsable» del reporte de facturación.
- **Compras:** documentos de compra y gasto vigentes.
- **Cuentas por cobrar y por pagar:** documentos a crédito menos recibos y egresos activos.
- **Existencias:** compras, saldo inicial y ajustes de inventario, menos las ventas.
- **Nómina:** liquidaciones aprobadas o pagadas.
- **Libros contables:** comprobantes contabilizados.

| Sección                       | Reportes (id)                                                                                                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ventas y cotizaciones         | cotizaciones-por-vendedor, ventas-por-cliente, ventas-por-producto, ventas-por-vendedor, ventas-cliente-producto, ventas-vendedor-producto, comparativo-ventas-mes (año vs año anterior), comparativo-ventas-producto y comparativo-ventas-vendedor (12 meses), obsequios, facturacion-electronica |
| Recibos y documentos de venta | recibos-por-factura, movimiento-facturas-venta, libro-ventas, remisiones-cruzadas                                                                                                                                                                                                                  |
| Clientes y proveedores        | cartera-general, cartera-por-documento, movimiento-cartera, movimiento-recibos (clientes o proveedores), cartera-corte (por edades a una fecha), terceros, contactos-terceros                                                                                                                      |
| Compras                       | compras-por-proveedor, compras-por-producto, compras-producto-proveedor, movimiento-compras, libro-compras                                                                                                                                                                                         |
| Productos                     | rentabilidad-producto, saldos-inventario, kardex, movimiento-productos, listado-productos                                                                                                                                                                                                          |
| Nómina                        | nomina-prima, nomina-provisiones, nomina-acumulados, nomina-seguridad-social                                                                                                                                                                                                                       |
| Contables y financieros       | consecutivo-comprobantes (con números faltantes), comprobantes-no-contabilizados, auxiliar-cuenta, cambios-patrimonio                                                                                                                                                                              |
| Tributario / libros oficiales | libro-inventarios-balance, impuestos-detallados (IVA generado y descontable por tarifa), libro-mayor, comprobante-diario                                                                                                                                                                           |
| Auditoría                     | auditoria-borrado (anulaciones y eliminaciones con usuario y motivo)                                                                                                                                                                                                                               |
| Configuración                 | localidades (en el navegador, con el catálogo DIVIPOLA de `apps/web/data`)                                                                                                                                                                                                                         |

Detalles de cálculo:

- **Obsequios:** renglones facturados sin valor (precio cero o descuento del 100 %), valorados al precio de lista del
  producto.
- **Rentabilidad por producto:**
  - usa meses completos;
  - el costo de ventas sale del costeo mensual, y un mes sin costeo aparece con costo cero y una nota;
  - los servicios no tienen costo.
- **Saldos de inventario:** se valoran con el costo promedio del último costeo ejecutado hasta el mes de corte.
- **Kárdex:** se lleva en unidades e inicia con el saldo anterior al período.
- **Prima de servicios y provisiones:** son valores provisionados en cada liquidación; Betel aún no registra el pago
  de prestaciones.
- **Comprobantes no contabilizados:** documentos vigentes sin comprobante contable (facturas, recibos, compras, egresos,
  nómina e inventario). Como Betel contabiliza en automático, lo normal es que esté vacío.
- **Auxiliar por cuenta:** cualquier código del PUC, con sus subcuentas; el saldo acumulado es débitos − créditos.

## Estado de resultados (`/reportes/estado-de-resultados`)

Sale de los comprobantes contabilizados del período, **sin el comprobante de cierre de año**, para que un año cerrado
siga mostrando su resultado. Agrupa por cuenta de 4 dígitos y compara con el período anterior de igual duración (que
termina el día antes del inicio). También muestra la variación porcentual. En el centro se usa también como «estado de
resultado integral por función de gastos», porque separa los gastos de administración (51) y de ventas (52).

| Renglón                         | Cálculo                                                  |
| ------------------------------- | -------------------------------------------------------- |
| Ingresos operacionales          | Grupo 41 (saldo crédito)                                 |
| Costo de ventas                 | Clases 6 y 7                                             |
| **Utilidad bruta**              | Ingresos operacionales − costo de ventas                 |
| Gastos de administración        | Grupo 51                                                 |
| Gastos de ventas                | Grupo 52                                                 |
| **Utilidad operacional**        | Utilidad bruta − 51 − 52                                 |
| Ingresos no operacionales       | Resto de la clase 4                                      |
| Gastos no operacionales         | Resto de la clase 5 (sin 54 ni 59)                       |
| **Utilidad antes de impuestos** | Operacional + no operacionales − gastos no operacionales |
| Impuesto de renta               | Grupo 54                                                 |
| **Utilidad neta del ejercicio** | Antes de impuestos − 54                                  |

## Estado de situación financiera (`/reportes/situacion-financiera`)

Saldos a la fecha de corte de todos los comprobantes contabilizados, incluido el cierre de año: activo (clase 1),
pasivo (2) y patrimonio (3), por grupo y cuenta. El resultado de los años **aún sin cerrar** (clases 4 a 7) aparece en
el patrimonio como "Resultado del ejercicio (años sin cerrar)". Así siempre se cumple activo = pasivo + patrimonio, y
la pantalla lo indica ("Cuadra" o "No cuadra").

Ambos estados se descargan en PDF, Excel (XLSX) y CSV.

## API

| Ruta                                       | Uso                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/reports/income-statement?from&to` | Renglones del estado, utilidad neta, período y período anterior. Por defecto, el mes en curso                            |
| `GET /v1/reports/balance-sheet?to`         | Renglones, totales (activo, pasivo, patrimonio, resultado sin cerrar) y `balanced`. Por defecto, hoy                     |
| `GET /v1/reports/catalog`                  | Reportes del catálogo que el rol de la sesión puede ver (id, título, filtros)                                            |
| `GET /v1/reports/catalog/:id`              | Ejecuta un reporte: `from`, `to`, `date`, `year`, `search`, `partyKind`, `account`, `product`; `export=1` para descargar |
| `GET /v1/reports/catalog-options/products` | Productos para el filtro del kárdex                                                                                      |

Valores por defecto: mes en curso, hoy y año en curso, en hora de Colombia. La respuesta trae `columns`, `data`,
`totals`, `notes`, `period` y `truncated`. El límite es de 5.000 filas; si hay más, se pide acotar el filtro.

## Permisos

| Acción                                                                             | Roles                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Ver el centro de reportes                                                          | Todos (cada reporte valida su propio permiso) |
| Ventas, cotizaciones, recibos por factura, terceros y productos (sin rentabilidad) | OWNER, ADMIN, ACCOUNTANT, SALES, VIEWER       |
| Cuentas por cobrar/pagar, compras, rentabilidad, nómina, contabilidad, auditoría   | OWNER, ADMIN, ACCOUNTANT                      |
| Estados financieros                                                                | OWNER, ADMIN, ACCOUNTANT                      |
| Descargar (PDF, Excel, CSV); queda en el AuditLog como `ReportCatalog EXPORT`      | OWNER, ADMIN, ACCOUNTANT                      |

La API responde 403 si el rol no tiene el reporte. El catálogo de la sesión solo lista los reportes permitidos.

## Limitaciones

- **Estados financieros:**
  - son individuales y sin notas;
  - no hay flujo de efectivo ni formatos configurables;
  - no se distingue entre corriente y no corriente;
  - no hay centros de costo;
  - muestran cuentas de 4 dígitos; el detalle por subcuenta está en el balance de prueba.
- **Facturas de contado:** quedan en 130505 Clientes hasta que exista su asiento de recaudo (tarea 26). Por eso el
  auxiliar de 1305 las muestra con saldo, aunque los reportes de cartera las tratan como pagadas.
- **Impuestos:** solo IVA. Betel aún no calcula retenciones ni impuesto al consumo.
- **Nómina:** la seguridad social es la base para la planilla PILA; Betel no la transmite. El pago de prima y
  cesantías no se registra.
- **Reportes por tercero contable:** no hay movimiento auxiliar de tercero por cuenta, porque los renglones contables
  no llevan tercero (tarea 43).
- **Filtros:** cada reporte tiene filtros fijos. No hay columnas configurables ni reportes favoritos (la estrella de la
  referencia).

## Pruebas

- Unitarias:
  - `apps/api/test/statements.test.ts`: utilidades intermedias, período anterior, cuadre con el resultado sin cerrar
    y después del cierre;
  - `apps/api/test/catalog.test.ts`: base e IVA por renglón, totales, filtros por defecto en hora de Colombia e
    integridad del catálogo.
- De punta a punta:
  - estados financieros: saldos iniciales, gasto del año anterior, venta del mes, cierre de año, permisos y
    aislamiento;
  - catálogo: datos de octubre (saldo inicial, compra a crédito, dos ventas con obsequio, recibo y recibo anulado,
    costeo, cotización y nómina) verificados en cada reporte, más descargas auditadas, permisos de SALES y aislamiento
    entre organizaciones.
- Casos de aceptación HT-30 y HT-31.
