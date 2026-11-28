# Costeo automático y kárdex

Productos y servicios › Costeo › **Modo de costeo**: _Mensual_ (el de siempre) o _Automático_ (kárdex permanente).
Código: `apps/api/src/kardex-engine.ts` (cálculo puro), `apps/api/src/kardex.ts` (base de datos, asientos y rutas),
`apps/web/components/kardex.tsx` (interruptor, «Recalcular kárdex» y pantalla Kárdex).

## Qué hace el modo automático

Cada documento que mueve inventario recalcula, en la misma transacción, el kárdex de los productos que toca:

| Documento                                  | Efecto en el kárdex                                    |
| ------------------------------------------ | ------------------------------------------------------ |
| Saldo inicial (SI)                         | Entrada al costo digitado                              |
| Compra (CG, tipo compra)                   | Entrada a precio unitario con descuento, **sin IVA**   |
| Ajuste de entrada (AJ)                     | Entrada al costo digitado                              |
| Ajuste de salida (AJ)                      | Salida al costo con que se registró (ya contabilizado) |
| Factura electrónica o POS emitida          | Salida al costo del kárdex                             |
| Anulación de compra o documento de inventario | El documento sale del kárdex y todo se recalcula    |

Así nadie tiene que entrar a «Calcular costeo»: el costo y el costo de ventas quedan al día solos.

### Método por producto

Según _Inventario › Método de valoración_ del producto:

- **Promedio ponderado** (por defecto): cada entrada recalcula
  `promedio = (valor del saldo + cantidad × costo de entrada) ÷ (saldo en unidades + cantidad)`. Las salidas salen
  al promedio vigente y no lo cambian.
- **PEPS**: cada entrada es una capa con su costo; las salidas consumen primero las capas más antiguas.
- _Identificación específica_ se calcula como promedio ponderado mientras las ventas no indiquen lote o serie.

Orden: por fecha del documento; el mismo día, primero saldo inicial, compras y ajustes de entrada, luego ventas y
ajustes de salida, y después por hora de registro. Un documento con fecha anterior recalcula todo lo posterior.

### Ejemplo (promedio ponderado)

| Movimiento                 | Cantidad | Costo unitario | Saldo | Valor del saldo | Promedio   |
| -------------------------- | -------: | -------------: | ----: | --------------: | ---------: |
| Saldo inicial              |       10 |       2.521,01 |    10 |       25.210,10 |   2.521,01 |
| Compra                     |        5 |       3.000,00 |    15 |       40.210,10 |   2.680,67 |
| Venta                      |       −4 |       2.680,67 |    11 |       29.487,41 |   2.680,67 |
| Compra                     |       10 |       2.800,00 |    21 |       57.487,41 |   2.737,50 |

La venta cuesta 4 × 2.680,6733 = **10.722,69**.

## Contabilidad

- Cada venta guarda su costo en el renglón (`InvoiceLine.unitAccountingCost` y `costTotal`) y contabiliza
  **Débito 613505 Costo de ventas / Crédito 143505 Inventario** con referencia `CMV-<documento>-1`, fechado el día de
  la venta.
- Si después cambia ese costo (una compra con fecha anterior, una anulación), se registra **solo la diferencia**:
  `CMV-<documento>-2`, `-3`… Nunca se borra un asiento.
- El costo vigente de cada producto queda en `Product.averageCost` (4 decimales).
- **Recalcular kárdex** (`POST /v1/costing/kardex/recalculate`) recorre todos los productos y ajusta lo que falte.
  Úsalo después de cambiar el método de valoración de un producto o si sospechas una diferencia.

## Activar y desactivar

- **Activar** fija `Organization.costingAutomaticFrom` en el día 1 del mes en curso. Si ese mes ya tenía «Costeo
  mensual», se reversa su asiento (`CV-AAAA-MM-vN-A`) y se borra la ejecución, para no duplicar el costo. Los meses
  anteriores no cambian y se pueden seguir costeando a mano.
- **Volver a mensual** reversa el costo contabilizado venta por venta (una entrada `CMV` por cada venta) y deja el
  cálculo mensual como antes.
- En modo automático, «Calcular costeo» de un mes desde la activación responde 409.
- Cambiar el modo y recalcular exigen el permiso _Inventario y costeo › Registrar y calcular_; cada cambio queda en
  la auditoría (`COSTING_MODE`, `KARDEX_RECALCULATE`).

## Existencias

En modo automático **no se emite una venta sin existencias suficientes**: la API responde 422 con el producto y
las unidades que faltan, y la factura queda en borrador. Si el producto tiene marcada _Permitir inventario
negativo_, la venta pasa y el faltante sale al último costo conocido; el kárdex lo marca «sin existencias».

## Pantalla Kárdex

`/productos/kardex?producto=<id>` (también desde Gestión de productos › ⌄ › Ver kárdex): saldo anterior, existencias,
costo unitario vigente y, por documento, entradas, salidas, costo unitario, costo total, saldo, valor y promedio,
con filtro de fechas y descarga en PDF, Excel o CSV. API: `GET /v1/products/:id/kardex?from=&to=`. En modo mensual
el kárdex también se ve (calculado al consultar), pero no contabiliza nada.

## Limitaciones

- La compra entra sin IVA, también cuando el IVA no es descontable: así coincide con el asiento de la compra, que
  lleva todo el IVA a 240810. Llevar el IVA no descontable al costo exige cambiar también ese asiento.
- Las notas crédito (devoluciones) y las remisiones todavía no mueven el kárdex, igual que en el costeo mensual.
- Los gastos (CG tipo gasto) y los documentos soporte no son entradas de inventario.
- Sin lotes ni series por venta, _Identificación específica_ se calcula como promedio ponderado.
- El bloqueo por existencias se verifica al emitir; la anulación posterior de una compra puede dejar ventas ya
  emitidas sin existencias (se marcan en el kárdex y salen al último costo).
