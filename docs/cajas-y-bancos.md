# Cajas y bancos

Módulo del menú lateral **Cajas y bancos** (`/bancos`): saldo de cada caja y cuenta bancaria **según la
contabilidad**, sin cifras digitadas a mano.

## Cajas y bancos (`/bancos`)

Columnas de la referencia: Código cuenta contable, Cuenta bancaria / caja y Saldo, con **Total general**.

| Dato          | Definición                                                                             |
| ------------- | -------------------------------------------------------------------------------------- |
| Cuentas       | Las del plan de cuentas cuyo código empieza por **1105** (caja) o **1110** (bancos)    |
| Saldo         | Σ débitos − Σ créditos de los comprobantes **contabilizados** con fecha hasta el corte |
| Total general | Suma de los saldos                                                                     |

- **Saldo al:** fecha de corte (hoy por defecto) para ver el saldo de cualquier día anterior.
- **Columnas:** el código se puede ocultar y se pueden mostrar Tipo, Débitos, Créditos y Último movimiento (se recuerda
  en el navegador).
- **Descargar** en PDF, Excel o CSV con el total general.
- El nombre y el saldo de cada cuenta abren sus **movimientos**.

**Qué mueve el saldo** (cada documento ya genera su asiento):

| Documento                                    | Caja 110505 (efectivo) / Bancos 111005 (otros medios) |
| -------------------------------------------- | ----------------------------------------------------- |
| Recibo de caja y pago en línea               | Entrada (débito)                                      |
| Compra o gasto de contado, documento soporte | Salida (crédito) de caja                              |
| Comprobante de egreso                        | Salida (crédito)                                      |
| Anulaciones                                  | Asiento inverso                                       |

Un saldo negativo indica que se registraron más salidas que entradas en esa cuenta (por ejemplo, compras de contado
pagadas en efectivo sin haber registrado el recaudo correspondiente).

## Movimientos de una cuenta (`/bancos/movimientos?cuenta=…`)

Auxiliar de la cuenta: período (este mes por defecto, o rápido/personalizado), saldo anterior, entradas, salidas y saldo
final; tabla con fecha, comprobante, descripción, débito, crédito y **saldo acumulado**, 50 por página. El comprobante
enlaza al documento que lo originó (recibo, factura, compra, documento soporte, cuentas por pagar del proveedor en los
comprobantes de egreso, documento de inventario). Descarga PDF, Excel o CSV (máx. 5.000 movimientos).

## Permisos

| Acción                         | Roles                          |
| ------------------------------ | ------------------------------ |
| Consultar saldos y movimientos | Los del Reporte de facturación |
| Descargar                      | OWNER, ADMIN, ACCOUNTANT       |

## API

| Método y ruta                               | Uso                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /v1/reports/banks?to=`                 | Saldos a la fecha de corte con total general                            |
| `GET /v1/reports/banks/export?to=`          | Lo mismo, auditado                                                      |
| `GET /v1/banks/:accountId/movements`        | Auxiliar paginado (from, to, page, pageSize) con saldo anterior y final |
| `GET /v1/banks/:accountId/movements/export` | Todos los movimientos del período, auditado                             |

Código en `apps/api/src/banks.ts` y `apps/web/components/banks.tsx`. No tiene tablas propias: lee `Account`,
`JournalEntry` y `JournalLine`.

## Limitaciones

- Hay **una caja (110505) y un banco (111005)**: todos los cobros y pagos que no son en efectivo van a "Bancos". Aún
  no se pueden crear varias cuentas bancarias (p. ej. una por banco) ni elegir la cuenta en cada recibo o pago
  (tarea 40).
- No hay **conciliación bancaria** ni importación de extractos (tarea 40).
- Los traslados entre caja y bancos (consignaciones) aún no tienen documento propio (tarea 40).

## Pruebas

- Unitarias: `apps/api/test/banks.test.ts` (saldo acumulado, tipo de cuenta, período).
- Caso de aceptación HT-26 en `docs/human-test.md`.
