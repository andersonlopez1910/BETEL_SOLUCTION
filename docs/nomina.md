# Nómina

Módulo del menú lateral **Nómina** (`/nomina`). La referencia de Siigo era un anuncio comercial (no una pantalla con
funciones), así que el módulo se diseñó para Betel: parámetros legales por año, empleados, liquidación quincenal o
mensual, pago, desprendibles y nómina electrónica.

**Acceso:** solo **OWNER, ADMIN y ACCOUNTANT** (los salarios son información sensible). Los vendedores y lectores ven
un aviso y la API responde 403.

## Pestañas

| Pestaña            | Qué hace                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nóminas            | Liquidaciones del año (NOM-n) con totales; **Nueva liquidación** (mensual o quincena 1–15 / 16–fin)                                                             |
| Empleados          | Crear, editar, retirar y reactivar: identificación, cargo, contrato, ingreso/retiro, salario, frecuencia, clase de riesgo ARL, EPS, pensión, cesantías y cuenta |
| Nómina electrónica | Por mes: devengado, deducciones y neto por empleado; **Generar y enviar a la DIAN** (documento NE-n)                                                            |
| Parámetros         | Valores legales del año; se **confirman** antes de poder liquidar ese año                                                                                       |

## Parámetros por año

Salario mínimo, auxilio de transporte, horas mensuales (según la jornada legal), recargos (extra diurna, extra
nocturna, nocturno, dominical/festivo), salud y pensión del empleado y del empleador, caja, ICBF, SENA y la
exoneración del art. 114-1 E.T. Si un año no tiene parámetros se **proponen los de 2025** (SMMLV $1.423.500, auxilio
$200.000, 220 horas, recargo dominical 80 %) con un aviso para revisarlos con los decretos del año. Sin confirmar no se
puede liquidar. Las tarifas ARL por clase de riesgo (I 0,522 % · II 1,044 % · III 2,436 % · IV 4,35 % · V 6,96 %) son
fijas (Decreto 1772 de 1994).

## Liquidación

1. **Nueva liquidación:** incluye a los empleados activos de esa frecuencia con contrato vigente en el período, con sus
   días (mes comercial de 30; quien ingresa o se retira a mitad de período tiene los días proporcionales). No se puede
   liquidar dos veces el mismo período ni un período futuro.
2. **Novedades** por empleado (en borrador): días, horas extra diurnas y nocturnas, horas con recargo nocturno y
   dominical/festivo, comisiones u otros pagos salariales, bonificaciones no salariales, retención en la fuente y otros
   descuentos (préstamos, libranzas). Cada cambio recalcula.
3. **Aprobar y contabilizar:** recalcula con los parámetros confirmados y registra la causación.
4. **Registrar pago:** neto a pagar contra caja o bancos (se ve en Cajas y bancos).
5. **Anular:** en borrador, o aprobada sin pagar y sin nómina electrónica transmitida (asiento inverso). Después se
   puede volver a liquidar el período.
6. **Desprendibles:** comprobante de pago por empleado (o todos, uno por página al imprimir).

### Cálculo

| Concepto                   | Regla                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Básico                     | Salario ÷ 30 × días                                                                                                                            |
| Valor hora                 | Salario ÷ horas mensuales                                                                                                                      |
| Horas extra                | Horas × valor hora × (1 + recargo); recargos nocturno y dominical: horas × valor hora × recargo. No aplican a salario integral                 |
| Auxilio de transporte      | Auxilio ÷ 30 × días si el salario es hasta 2 SMMLV (no integral). No hace parte del IBC                                                        |
| IBC                        | Devengos salariales (integral: 70 %), entre 1 y 25 SMMLV proporcionales a los días                                                             |
| Salud y pensión (empleado) | % del IBC                                                                                                                                      |
| Fondo de Solidaridad       | 1 % del IBC desde 4 SMMLV; 1,2 % / 1,4 % / 1,6 % / 1,8 % / 2 % desde 16, 17, 18, 19 y 20 SMMLV                                                 |
| Aportes del empleador      | Salud, pensión, ARL, caja, ICBF y SENA sobre el IBC; salud, ICBF y SENA en 0 si la empresa está exonerada y el empleado gana menos de 10 SMMLV |
| Cesantías y prima          | (Devengos salariales + auxilio) ÷ 12 (no en salario integral)                                                                                  |
| Intereses sobre cesantías  | 12 % de las cesantías                                                                                                                          |
| Vacaciones                 | Básico ÷ 24                                                                                                                                    |

Ejemplo verificado en las pruebas: salario $2.000.000, 30 días y 2 horas extra diurnas (parámetros de 2025) → devengado
$2.222.727,27, deducciones $161.818,18, **neto $2.060.909,09** y costo del empleador $810.210,14.

### Contabilidad

| Momento | Débito                                                                                                                  | Crédito                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aprobar | 510506 Sueldos, 510515 Extras, 510548 Bonificaciones, 510527 Auxilio, 510568–510578 Aportes, 510530–510539 Prestaciones | 237005 EPS, 238030 Pensiones, 237006 ARL, 237010 Parafiscales, 236505 Retención, 237095 Otros descuentos, 251005 Cesantías, 251505 Intereses, 252005 Prima y 252505 Vacaciones, **250505 Salarios por pagar** |
| Pagar   | 250505 Salarios por pagar                                                                                               | 110505 Caja o 111005 Bancos                                                                                                                                                                                   |
| Anular  | Asiento inverso de la causación (`NOM-n-A`)                                                                             |                                                                                                                                                                                                               |

## Nómina electrónica

Documento soporte de pago de nómina electrónica **mensual por empleado** (NE-n) con lo devengado y deducido en las
liquidaciones aprobadas o pagadas que terminan en el mes. Se envía por el puerto DIAN (`dian.ts`, `submitPayroll`);
con el proveedor de pruebas queda **En cola DIAN**. Reenviar actualiza los documentos no aceptados conservando su
número; si una liquidación cambia después del envío se marca para volver a enviar.

## API

| Método y ruta                                                    | Uso                                              |
| ---------------------------------------------------------------- | ------------------------------------------------ |
| `GET/PUT /v1/payroll/settings/:year`                             | Parámetros (propuestos si no existen; confirmar) |
| `GET/POST /v1/payroll/employees`, `PUT /:id`, `POST /:id/active` | Empleados                                        |
| `GET /v1/payroll/runs?year=`, `POST /v1/payroll/runs`            | Liquidaciones                                    |
| `GET /v1/payroll/runs/:id`                                       | Detalle con el cálculo por empleado              |
| `PUT /v1/payroll/runs/:id/items/:itemId`                         | Novedades (borrador)                             |
| `POST /v1/payroll/runs/:id/approve`, `/pay`, `/void`             | Aprobar, pagar, anular                           |
| `GET /v1/payroll/electronic?year=&month=`                        | Nómina electrónica del mes                       |
| `POST /v1/payroll/electronic/:year/:month/transmit`              | Generar y enviar                                 |

Tablas `PayrollSettings`, `Employee`, `PayrollRun`, `PayrollItem` y `PayrollElectronic` con RLS (migración
`20261126000000_add_payroll`). Código en `apps/api/src/payroll.ts` y `apps/web/components/payroll*.tsx`.

## Limitaciones

- La **retención en la fuente** se digita (no se calcula el procedimiento 1 o 2).
- No hay **vacaciones disfrutadas, incapacidades, licencias ni liquidación de contrato** (prestaciones al retiro), ni
  pago de prima y cesantías consolidadas, ni la regla del 40 % de pagos no salariales (tarea 41).
- No genera la **planilla PILA**; los aportes quedan por pagar en la contabilidad.
- Aprendices SENA y pensionados no se manejan.
- Un cambio de jornada a mitad de año (p. ej. 42 horas desde julio de 2026) se refleja editando las horas mensuales
  del año antes de liquidar los meses siguientes; las liquidaciones aprobadas no cambian.
- Nómina electrónica con el proveedor DIAN de pruebas: no se transmite ni hay notas de ajuste o eliminación.

## Pruebas

- Unitarias: `apps/api/test/payroll.test.ts` (casos calculados a mano: ordinario con extras, quincena con mínimo,
  integral, tope de 25 SMMLV, días comerciales, asiento cuadrado, validaciones).
- Caso de aceptación HT-27 en `docs/human-test.md`.
