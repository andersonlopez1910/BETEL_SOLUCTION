# Reporte de facturación

Módulo de consulta en `/reportes/facturacion`, con nueve pestañas en este orden: **Ventas, Recaudos,
Gestión de cobro cartera Betel, Cotizaciones, Remisiones, Facturas recurrentes, Envío masivo, Clientes y
Seguimiento comercial**. La pestaña activa va en la URL (`?tab=ventas`, `?tab=clientes`, …).

## Estado por pestaña

| Pestaña                        | Estado                 | Fuente de datos                                                     |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------- |
| Ventas                         | ✅ Datos reales        | `Invoice`, `Party`, `AuditLog` (responsable), `User`                |
| Recaudos                       | ⛔ Sin fuente de datos | No existe tabla de pagos ni abonos                                  |
| Gestión de cobro cartera Betel | ⛔ Sin fuente de datos | No existe el módulo de cartera ni registro de gestiones de cobro    |
| Cotizaciones                   | ⛔ Sin fuente de datos | No existe el módulo                                                 |
| Remisiones                     | ⛔ Sin fuente de datos | No existe el módulo                                                 |
| Facturas recurrentes           | ⛔ Sin fuente de datos | No existe el módulo                                                 |
| Envío masivo                   | ⛔ Sin fuente de datos | No existe el módulo ni registro de correos enviados                 |
| Clientes                       | ✅ Parcial             | `Party` + `Invoice`. Recaudado y saldo dependen del módulo Recaudos |
| Seguimiento comercial          | ⛔ Sin fuente de datos | No existe el módulo comercial                                       |

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
mezclan valores facturados con recaudados (no hay recaudos); las cotizaciones y remisiones no existen,
así que tampoco pueden contarse como facturas.

**Notas crédito:** hoy solo existen como tipo en `ElectronicEvent.kind`, no como documento que ajuste
el valor de una factura. Cuando se implementen, el total de ventas debe restarlas (ver tareas).

## API

Rutas en `apps/api/src/reports.ts`. Los filtros se validan con `salesReportQuerySchema` y
`customerReportQuerySchema` de `@betel/contracts` (422 si son inválidos).

| Ruta                                       | Uso                                                        |
| ------------------------------------------ | ---------------------------------------------------------- |
| `GET /v1/reports/billing/users`            | Usuarios de la organización (filtro "Usuario responsable") |
| `GET /v1/reports/billing/sales`            | Filas paginadas + indicadores + series por día y por mes   |
| `GET /v1/reports/billing/sales/export`     | Todas las filas filtradas (máx. 5.000) + indicadores       |
| `GET /v1/reports/billing/customers`        | Consolidado por cliente, paginado                          |
| `GET /v1/reports/billing/customers/export` | Todos los clientes filtrados (máx. 5.000)                  |
| `GET /v1/reports/billing/customers/:id`    | Historial de facturas y evolución mensual de un cliente    |

Filtros de Ventas: `from`, `to` (AAAA-MM-DD), `customer` (nombre o identificación), `number` (prefijo o
número), `status`, `userId`, `page`, `pageSize` (máx. 100). Filtros de Clientes: `from`, `to`, `search`,
`page`, `pageSize`.

### Permisos (validados en el backend)

| Rol                      | Consultar | Exportar |
| ------------------------ | --------- | -------- |
| OWNER, ADMIN, ACCOUNTANT | ✅        | ✅       |
| SALES, VIEWER            | ✅        | ❌ (403) |
| SUPPORT                  | ❌ (403)  | ❌ (403) |

Cada exportación queda en `AuditLog` (`entity = "BillingReport"`, `action = "EXPORT"`, con los filtros
y la cantidad de filas). Los datos se leen con `withOrganizationScope`, así que RLS impide ver
información de otra organización.

### Rendimiento

- Paginación en el servidor; los indicadores se calculan con `aggregate` y `groupBy`, sin traer filas.
- El responsable se resuelve con una sola consulta por página.
- Índices usados: `Invoice(organizationId, status, issueDate)` (existente) y
  `Invoice(organizationId, customerId, issueDate)` (nuevo, migración `20261103000000_add_invoice_customer_report_index`).
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

## Problemas encontrados en el sistema existente

1. **El frontend no estaba conectado a la API** ni tiene inicio de sesión. Este módulo agregó
   `apps/web/lib/api.ts`, que en desarrollo usa `POST /v1/auth/dev/session`. Falta el login real.
2. **La emisión no asigna número a la factura** (`prefix`/`number` quedan vacíos); el reporte muestra
   "Sin numerar".
3. **Descuadre de un centavo en `calculateDocumentTotals`:** redondea con `Number`, así que una línea
   de $50.000,50 con IVA 19 % se guarda con IVA 9.500,09 y total 59.500,60 (subtotal + IVA = 59.500,59).
   El reporte suma los valores guardados, como debe, pero el cálculo de origen debería usar `Decimal`.
4. No existe el estado del cliente (activo/inactivo) en `Party`, por eso no se muestra.
