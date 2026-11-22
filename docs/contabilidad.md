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

| Proceso                                | Ruta                              | Qué hace                                                                                                                                       |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Balance de prueba                      | `/contabilidad/balance-de-prueba` | Por período y nivel: saldo inicial, débitos, créditos y saldo final (débito +, crédito −), totales y aviso de si cuadra; descarga PDF/XLSX/CSV |
| Libro diario                           | `/contabilidad/libro-diario`      | Comprobantes del período (automáticos y manuales) con origen, búsqueda y detalle                                                               |
| Comprobante contable                   | `/contabilidad/comprobante/nuevo` | Comprobante manual **CC-n** (ajustes, causaciones, reclasificaciones)                                                                          |
| Cajas y bancos, Costeo mensual, Nómina | sus módulos                       | Accesos a los procesos contables de otros módulos                                                                                              |

**Comprobante manual:**

- Fecha (no futura), descripción y al menos dos renglones; cada renglón con débito **o** crédito.
- **Débitos = créditos.** Solo en **cuentas de movimiento**: de la organización, activas y sin subcuentas.
- **Anular:** solo los manuales. Quedan REVERSED, dejan de sumar y se ven tachados en el libro diario. Los automáticos
  se anulan desde su documento (factura, recibo, compra…).

## Permisos

| Acción                                                  | Roles                          |
| ------------------------------------------------------- | ------------------------------ |
| Ver el plan de cuentas                                  | Los del Reporte de facturación |
| Crear, editar o eliminar cuentas; comprobantes manuales | OWNER, ADMIN, ACCOUNTANT       |
| Balance de prueba y libro diario                        | OWNER, ADMIN, ACCOUNTANT       |

## API

| Método y ruta                            | Uso                                           |
| ---------------------------------------- | --------------------------------------------- |
| `GET /v1/accounting/chart`               | Árbol con saldos acumulados                   |
| `POST /v1/accounting/accounts`           | Crear (parentCode, suffix, name)              |
| `PUT/DELETE /v1/accounting/accounts/:id` | Editar o eliminar                             |
| `GET /v1/accounting/trial-balance`       | Balance de prueba (from, to, level 1/2/4/6/8) |
| `GET /v1/accounting/journal`             | Libro diario (from, to, search, source, page) |
| `GET /v1/accounting/journal/:id`         | Detalle de un comprobante                     |
| `POST /v1/accounting/journal`            | Comprobante manual                            |
| `POST /v1/accounting/journal/:id/void`   | Anular comprobante manual                     |

Código en `apps/api/src/ledger.ts`, `apps/api/src/puc.ts`, `apps/web/components/accounting.tsx` y
`apps/web/components/ledger-reports.tsx`. Sin tablas nuevas: usa `Account`, `JournalEntry` y `JournalLine`.

## Limitaciones

- Los comprobantes automáticos siguen usando las cuentas del sistema (p. ej. 110505) aunque se les creen auxiliares.
- No hay cierre contable de períodos, estados financieros (balance general, estado de resultados), libro mayor por
  tercero ni exógena (tarea 42).
- El PUC base no trae todas las cuentas de 4 dígitos: las que falten se crean bajo su grupo.
- La descarga del plan de cuentas se arma en el navegador con los datos del árbol (no queda en la auditoría).

## Pruebas

- Unitarias: `apps/api/test/ledger.test.ts` (niveles y padres del PUC, árbol con saldos y naturaleza, balance de
  prueba por nivel, validaciones del comprobante).
- Caso de aceptación HT-28 en `docs/human-test.md`.
