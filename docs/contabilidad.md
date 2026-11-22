# Contabilidad

Módulo del menú lateral **Contabilidad** (`/contabilidad`) con los submenús **Cuentas contables** y **Más procesos**.
Todos los saldos salen de los comprobantes contabilizados (`JournalEntry` con estado POSTED).

## Cuentas contables (plan de cuentas)

Árbol del PUC (Decreto 2650 de 1993) por niveles: **clase** (1 dígito) › **grupo** (2) › **cuenta** (4) ›
**subcuenta** (6) › **auxiliar** (8).

- **Estructura base** (`apps/api/src/puc.ts`): las 9 clases, los grupos y las cuentas de 4 dígitos más usadas (todas
  las que usan los comprobantes automáticos). Es fija: no se edita.
- **Cuentas de la organización** (tabla `Account`): las crea Betel al contabilizar (caja 110505, bancos 111005,
  clientes 130505, IVA 240805/240810, ingresos 413595, proveedores 220505, nómina 2505xx/5105xx…) o el usuario.
- Como en la referencia: columnas Código y Cuenta contable con **búsqueda por código y por nombre** (muestra las
  coincidencias con sus grupos desplegados), **Expandir / Contraer todos los detalles**, **Descargar Excel** y el
  panel derecho ("Para crear o editar, selecciona una cuenta…").
- **Panel de la cuenta:** nivel, origen (PUC o de la organización), naturaleza (débito: clases 1, 5, 6, 7 y 8;
  crédito: 2, 3, 4 y 9), estado, "Usada por Betel", "De movimiento"; saldo, débitos, créditos y número de movimientos
  acumulados de la cuenta y sus subcuentas (con su naturaleza: un pasivo o un ingreso se ve en positivo).
- **Crear:** bajo un grupo (cuenta de 4 dígitos que no esté en el PUC base), bajo una cuenta (subcuenta) o bajo una
  subcuenta (auxiliar), con 2 dígitos y nombre.
- **Editar:** nombre y activa/inactiva. **Eliminar:** solo sin movimientos ni subcuentas.
- **Cuentas del sistema** (las que usan los comprobantes automáticos): se pueden renombrar pero no inactivar ni
  eliminar.

## Más procesos

Seis grupos, como la referencia. Los procesos sin desarrollo muestran el aviso **En desarrollo** con el motivo (sin
enlace ni botón).

| Grupo                          | Proceso                                     | Estado                                                           |
| ------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- |
| Contables                      | Diferencia en cambio                        | No aplica aún: Betel no registra moneda extranjera               |
|                                | **Cierre de año**                           | Funcional (`/contabilidad/cierre-de-ano`)                        |
|                                | Cierre de cuentas de impuestos por tercero  | Pendiente: requiere tercero en cada renglón contable             |
|                                | Verifica y bloquea documentos               | Pendiente (tarea 43)                                             |
|                                | **Copias de comprobantes favoritos**        | Funcional (`/contabilidad/favoritos`)                            |
|                                | **Borrado masivo de comprobantes**          | Funcional como anulación masiva (`/contabilidad/borrado-masivo`) |
| Medios Magnéticos              | Asistente e informe distrital/municipal     | Pendiente: requieren tercero en cada renglón (tarea 43)          |
| Activos fijos                  | Creación e importación                      | Pendiente (tarea 43)                                             |
| Certificados                   | Retención a título de renta, IVA e ICA      | Pendiente: Betel aún no calcula retenciones                      |
|                                | **Ingresos y retenciones / Formulario 220** | Funcional (`/contabilidad/certificado-ingresos`)                 |
| Saldos iniciales               | Cuentas por cobrar y por pagar              | Pendiente (tarea 43)                                             |
|                                | **Inventario**                              | Funcional: saldo inicial de Documentos de productos / servicios  |
| Saldos iniciales otras cuentas | **Otras cuentas contables**                 | Funcional (`/contabilidad/saldos-iniciales`)                     |

Además siguen disponibles el balance de prueba, el libro diario y el comprobante contable manual
(`/contabilidad/balance-de-prueba`, `/contabilidad/libro-diario`, `/contabilidad/comprobante/nuevo`).

### Cierre de año

- Solo un año ya terminado. Vista previa con ingresos, gastos y costos del año y el resultado.
- Asiento **CIERRE-AAAA** al 31 de diciembre: lleva a cero cada cuenta de las clases 4 a 7 y traslada la diferencia a
  **360505 Utilidad del ejercicio** (crédito) o **361005 Pérdida del ejercicio** (débito).
- Un año no se cierra dos veces; el cierre se puede anular y repetir.
- **Desactualizado:** si después del cierre se registran ingresos, gastos o costos de ese año (p. ej. una nómina de
  diciembre aprobada tarde), la pantalla lo advierte para anular y volver a cerrar.

### Comprobantes favoritos

Desde el detalle de cualquier comprobante, **Guardar como favorito** guarda cuentas, valores y detalle. En
Favoritos, **Usar** abre el comprobante manual con esos datos para cambiarlos y contabilizar. Tabla `JournalTemplate`
con RLS (migración `20261127000000_add_journal_templates`).

### Borrado masivo

Selecciona comprobantes manuales o de saldos iniciales vigentes de un período y los **anula** con un motivo (en Betel
no se borran, para conservar la trazabilidad). Los automáticos se omiten: se anulan desde su documento.

### Saldos iniciales de otras cuentas

Comprobante **SIC-n** con el mismo formulario del comprobante manual, solo en cuentas de balance (clases 1, 2 y 3) y
cuadrado. Aparece en el libro diario como "Saldos iniciales" y se anula como un manual.

### Certificado de ingresos y retenciones (Formulario 220)

Por año gravable y empleado (uno por página al imprimir), con los datos del retenedor y del trabajador y, de las
liquidaciones de nómina aprobadas o pagadas del año: pagos por salarios (básico, extras, recargos y pagos
salariales), auxilio de transporte, otros pagos no salariales, total de ingresos brutos, aportes obligatorios de salud
y de pensión (con Fondo de Solidaridad) a cargo del trabajador y retención en la fuente. Solo OWNER, ADMIN y
ACCOUNTANT. Es una base para el formato 220: las casillas deben verificarse con la resolución vigente del año y aún
no incluye las prestaciones sociales pagadas (cesantías, prima), que Betel no registra.

## Permisos

| Acción                                                     | Roles                          |
| ---------------------------------------------------------- | ------------------------------ |
| Ver el plan de cuentas                                     | Los del Reporte de facturación |
| Crear, editar o eliminar cuentas; comprobantes manuales    | OWNER, ADMIN, ACCOUNTANT       |
| Balance de prueba y libro diario                           | OWNER, ADMIN, ACCOUNTANT       |
| Cierre de año, favoritos, borrado masivo, saldos iniciales | OWNER, ADMIN, ACCOUNTANT       |
| Certificado de ingresos y retenciones                      | OWNER, ADMIN, ACCOUNTANT       |

## API

| Método y ruta                                            | Uso                                           |
| -------------------------------------------------------- | --------------------------------------------- |
| `GET /v1/accounting/chart`                               | Árbol con saldos acumulados                   |
| `POST /v1/accounting/accounts`                           | Crear (parentCode, suffix, name)              |
| `PUT/DELETE /v1/accounting/accounts/:id`                 | Editar o eliminar                             |
| `GET /v1/accounting/trial-balance`                       | Balance de prueba (from, to, level 1/2/4/6/8) |
| `GET /v1/accounting/journal`                             | Libro diario (from, to, search, source, page) |
| `GET /v1/accounting/journal/:id`                         | Detalle de un comprobante                     |
| `POST /v1/accounting/journal`                            | Comprobante manual                            |
| `POST /v1/accounting/journal/:id/void`                   | Anular comprobante manual                     |
| `POST /v1/accounting/journal` con `kind: OPENING`        | Saldos iniciales de otras cuentas (SIC-n)     |
| `POST /v1/accounting/journal/bulk-void`                  | Anulación masiva (ids, reason)                |
| `GET/POST /v1/accounting/templates`, `DELETE /:id`       | Comprobantes favoritos                        |
| `GET/POST /v1/accounting/year-close`, `POST /:year/void` | Cierre de año (vista previa, cerrar, anular)  |
| `GET /v1/payroll/certificates?year=`                     | Certificado de ingresos y retenciones         |

Código en `apps/api/src/ledger.ts`, `apps/api/src/puc.ts`, `apps/web/components/accounting.tsx` y
`apps/web/components/ledger-reports.tsx`. Sin tablas nuevas: usa `Account`, `JournalEntry` y `JournalLine`.

## Limitaciones

- Los comprobantes automáticos siguen usando las cuentas del sistema (p. ej. 110505) aunque se les creen auxiliares.
- No hay bloqueo de períodos, estados financieros (balance general, estado de resultados), libro mayor por
  tercero ni exógena (tarea 42).
- El PUC base no trae todas las cuentas de 4 dígitos: las que falten se crean bajo su grupo.
- La descarga del plan de cuentas se arma en el navegador con los datos del árbol (no queda en la auditoría).

## Pruebas

- Unitarias: `apps/api/test/ledger.test.ts` (niveles y padres del PUC, árbol con saldos y naturaleza, balance de
  prueba por nivel, validaciones del comprobante, cierre de año con utilidad y con pérdida).
- Casos de aceptación HT-28 y HT-29 en `docs/human-test.md`.
