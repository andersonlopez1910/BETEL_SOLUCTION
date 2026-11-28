# Parametrización tributaria de productos y servicios

Un producto o servicio se configura una sola vez (costo, precio e impuestos), y esa configuración se usa en
inventarios, importación, factura electrónica, documento equivalente POS, contabilidad, reportes y exportaciones.

```
Producto / Servicio → Parametrización tributaria → Facturación (FE y POS) → Contabilidad → Reportes
```

## Motor tributario único

`packages/contracts/src/tax-engine.ts`. Es el **único** cálculo de IVA, INC y costo contable del sistema. Lo usan:

| Dónde                       | Para qué                                                          |
| --------------------------- | ----------------------------------------------------------------- |
| API, productos              | Calcula y guarda los valores al crear, editar o importar          |
| API, facturas               | `computeLine` de cada renglón (FE y POS); el AIU se aplica encima |
| Web, formulario de producto | Resumen tributario en tiempo real                                 |
| Web, factura                | Base, IVA, INC y total de cada renglón mientras se digita         |
| API, importación            | Vista previa y valores de cada fila                               |

La web lo importa como `@betel/contracts/tax-engine`, sin el resto de esquemas. Al guardar, el servidor siempre
vuelve a calcular.

### Funciones

| Función       | Qué calcula                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `computeCost` | Costo con o sin IVA incluido: base, IVA de compra, total, IVA descontable y no descontable, y costo contable (base + IVA no descontable) |
| `computeSale` | Precio con o sin impuesto incluido: base, IVA, INC y precio final                                                                        |
| `computeLine` | Renglón de documento: precio × cantidad − descuento = base; luego IVA e INC                                                              |
| `grossProfit` | Utilidad (base de venta − costo contable) y margen bruto                                                                                 |

### Tratamientos

- **Compra:** GRAVADO_19, GRAVADO_5, EXENTO, EXCLUIDO, NO_GRAVADO.
- **IVA descontable:** DESCONTABLE_TOTAL, DESCONTABLE_PARCIAL (con %), NO_DESCONTABLE.
- **Venta:** IVA_19, IVA_5, IVA_EXENTO, IVA_EXCLUIDO, NO_GRAVADO, INC (8 % por defecto, configurable) y SIN_IMPUESTO.
- **Canal de facturación:** FE, POS, AMBOS, NO_FACTURABLE. Se valida al facturar.

Exento, excluido y no gravado tienen tarifa 0 %, pero conservan códigos distintos en el producto, en la importación y
en la fotografía del renglón.

### Redondeo

- Los cálculos intermedios usan 4 decimales y los valores guardados, 2.
- **Con impuesto incluido:** el total es exactamente el valor digitado y el impuesto es la diferencia (total − base).
  Por eso base + impuestos = total, sin diferencias de $0,01.
- **Sin impuesto incluido:** cada impuesto se redondea una vez, y total = base + impuestos.
- El IVA **nunca se suma dos veces**: si el precio lo incluye, se discrimina.

## Producto (base de datos)

Se guardan los valores **digitados** y los **calculados** (migración `20261212000000_product_tax_parametrization`):

| Grupo           | Campos                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Costo           | costEntered, costIncludesVat, purchaseVatTreatment, purchaseVatRate, deductibleTreatment, deductiblePct, costBase, purchaseVat, costTotal, vatDeductible, vatNonDeductible, accountingCost |
| Precio de venta | priceEntered, priceIncludesTaxes, saleTaxTreatment, taxRate (IVA), incRate, unitPrice (base), saleVat, saleInc, finalPrice                                                                 |
| Otros           | category, unspscCode, billingChannel; inventario con control por lote, serial y vencimiento                                                                                                |

`unitPrice` sigue siendo el precio **base** de venta, así que los módulos anteriores lo leen igual. La API deriva
los campos anteriores (`taxRate`, `taxTreatment`, INC) a partir de la sección `sale`.

**Cantidad inicial:** al crear un producto inventariable, se registra el documento de saldo inicial (SI-n) valorado
al costo contable, con su asiento contable.

## Factura electrónica y documento equivalente POS

- Al elegir un producto se cargan su precio digitado, si incluye impuesto, su tratamiento, sus tarifas, la unidad
  y el código. El precio se puede editar sin perder la configuración tributaria.
- El detalle muestra precio, descuento, base, IVA (tarifa y valor), INC (tarifa y valor) y total.
- **Fotografía tributaria:** cada renglón guarda si el precio incluía impuesto, el tratamiento y el costo contable
  del momento. Cambiar el producto después no recalcula documentos emitidos.
- **POS:** se elige en «Tipo» del formulario de venta. Usa el mismo motor; cambian solo el documento (evento DIAN
  `POS_EQUIVALENT`), la numeración (`POS-n`), el asiento (`POS-…`) y el título en la tirilla y en la hoja carta. El
  canal de facturación del producto se valida.

### Contabilización

Al emitir se usan los mismos valores calculados:

| Cuenta         | Movimiento        |
| -------------- | ----------------- |
| Débito 130505  | Total             |
| Crédito 413595 | Total − IVA − INC |
| Crédito 240805 | IVA               |
| Crédito 246405 | INC               |

El costo de ventas de los inventariables lo registra el **costeo mensual** (costo promedio ponderado, asiento
613505 / 143505), como antes. No se registra venta por venta, para no duplicarlo.

## Importación y exportación

- **Plantilla:** 22 columnas (`IMPORT_COLUMNS` en `apps/api/src/product-import.ts`). Se sigue aceptando la plantilla
  anterior.
- **Vista previa obligatoria:** `POST /v1/products/import/preview` analiza sin escribir y devuelve, por fila, el
  estado (Correcto, Advertencia o Error), los mensajes y los valores calculados.
- **Importación:** `POST /v1/products/import` vuelve a analizar en el servidor e importa solo las filas sin error, por
  el mismo camino que la creación manual. Los inventariables usan las cuentas 143505 y 613505.
- **Exportación:** lo digitado y lo calculado en 30 columnas; montos, tarifas y existencias van como números.

## Reporte de facturación › Detalle tributario

`GET /v1/reports/billing/tax-detail` (`apps/api/src/billing-tax-report.ts`):

- **Filas:** un renglón por producto vendido, de FE y POS, con las columnas del punto 21.
- **KPI:** ventas antes de impuestos, IVA, INC, descuentos, ventas totales, costo, utilidad y margen.
- **Filtros:** fecha, cliente, producto, categoría, vendedor, tipo de documento, tarifa IVA y estado.
- **Excel:** hojas RESUMEN y DETALLE.
- **Permisos:** consultar requiere `reports.view` y descargar, `reports.export`; la descarga se audita.

## Limitaciones

- **Bodegas:** Betel maneja una sola bodega por empresa; «Bodega inicial» es informativa.
- **Lotes, seriales y vencimiento:** se configuran en el producto, pero los documentos aún no registran el lote, el
  serial ni la fecha de vencimiento.
- **DIAN:** la factura y el POS siguen en el ambiente de pruebas. El XML UBL y la resolución POS se completan al
  conectar el proveedor tecnológico.
- **Retefuente:** la columna del detalle de factura depende de las retenciones, que el formulario aún no envía.
- **Costo de ventas:** es mensual (costeo); los métodos PEPS e identificación específica quedan configurados, pero
  el costeo calcula promedio ponderado.
- **Descuento en valor con precio con impuesto incluido:** se interpreta en la misma forma que el precio, es decir,
  con impuestos.

## Pruebas

- Unitarias:
  - `shared-tax-engine.test.ts`: casos 1 a 4, utilidad y margen, IVA descontable, INC, renglones y barrido sin
    diferencias de $0,01;
  - `product-import.test.ts`: caso 5 y validaciones;
  - `tax-engine.test.ts` y `billing-tax-report.test.ts`.
- De punta a punta (scripts de la sesión):
  - parametrización → factura → asiento (casos 1 a 4 y 7, histórico);
  - importación con vista previa y exportación (casos 5 y 6);
  - POS y detalle tributario.
