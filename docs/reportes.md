# Reportes

Menú lateral **Reportes** (`/reportes`). Reúne en una sola pantalla todos los reportes de Betel, agrupados por área,
con un enlace directo a cada uno. Agrega los dos estados financieros básicos: **estado de resultados** y **estado de
situación financiera**.

- Web: `apps/web/components/financial-reports.tsx`, páginas en `apps/web/app/(app)/reportes/`.
- API: `apps/api/src/statements.ts`.

## Centro de reportes

| Área                   | Reportes (enlace)                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estados financieros    | Estado de resultados, estado de situación financiera, balance de prueba, libro diario, plan de cuentas                                                                 |
| Ventas y facturación   | Pestañas de `/reportes/facturacion`: ventas, recaudos, gestión de cobro, cotizaciones, remisiones, facturas recurrentes, envío masivo, clientes, seguimiento comercial |
| Compras y gastos       | Documentos, registro de eventos, proveedores, soporte por legalizar                                                                                                    |
| Productos e inventario | Gestión de productos, documentos de productos, costeo mensual                                                                                                          |
| Cajas y bancos         | Saldos de cajas y bancos con su auxiliar                                                                                                                               |
| Nómina                 | Liquidaciones, nómina electrónica, certificado de ingresos y retenciones                                                                                               |

El centro solo enlaza: cada reporte conserva sus filtros, descargas y permisos. En el menú lateral, **Reporte de
facturación** se resalta en `/reportes/facturacion` y **Reportes** en el centro y en los estados financieros.

## Estado de resultados (`/reportes/estado-de-resultados`)

Sale de los comprobantes contabilizados del período, **sin el comprobante de cierre de año**, para que un año cerrado
siga mostrando su resultado. Agrupa por cuenta de 4 dígitos y compara con el período anterior de igual duración (que
termina el día antes del inicio). También muestra la variación porcentual.

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

| Ruta                                       | Uso                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `GET /v1/reports/income-statement?from&to` | Renglones del estado, utilidad neta, período y período anterior. Por defecto, el mes en curso        |
| `GET /v1/reports/balance-sheet?to`         | Renglones, totales (activo, pasivo, patrimonio, resultado sin cerrar) y `balanced`. Por defecto, hoy |

## Permisos

| Acción                         | Roles                                         |
| ------------------------------ | --------------------------------------------- |
| Ver el centro de reportes      | Todos (cada enlace valida su propio permiso)  |
| Estados financieros y descarga | OWNER, ADMIN, ACCOUNTANT (validado en la API) |

## Limitaciones

- Son estados **individuales y sin notas**: no hay estado de cambios en el patrimonio, flujo de efectivo ni notas a los
  estados financieros.
- Muestran cuentas de 4 dígitos; para el detalle por subcuenta o auxiliar está el balance de prueba.
- No hay comparación entre años ni entre centros de costo. Betel no maneja centros de costo.
- Clasificación corriente / no corriente: no se distingue; el balance sigue el orden del PUC.

## Pruebas

- Unitarias: `apps/api/test/statements.test.ts` (utilidades intermedias, período anterior, cuadre con resultado sin
  cerrar y después del cierre).
- De punta a punta: saldos iniciales, gasto del año anterior, venta del mes, cierre de año, permisos y aislamiento.
- Caso de aceptación HT-30.
