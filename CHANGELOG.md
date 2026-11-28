# Historial de cambios

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto sigue versionado semántico.

## [Sin publicar]

### Agregado

- **Parametrización tributaria integral** (ver `docs/parametrizacion-tributaria.md`): motor tributario único
  (`@betel/contracts/tax-engine`) para costo con o sin IVA, IVA descontable, costo contable, precio con o sin
  impuesto, IVA 19/5, exento, excluido, no gravado, INC y sin impuesto. Formulario de producto y servicio por
  secciones con resumen en tiempo real; importación de 22 columnas con vista previa; exportación con lo digitado y
  lo calculado; factura que carga la configuración y no suma el IVA dos veces; fotografía tributaria por renglón;
  documento equivalente POS con el mismo motor; INC contabilizado en 246405; Reporte de facturación › Detalle
  tributario con KPI, filtros y Excel RESUMEN/DETALLE.
- **Permisos editables por rol** (Configuración › Usuarios y permisos): el propietario marca o desmarca qué puede
  hacer cada rol (19 permisos: facturas, cotizaciones, recibos, compras, inventario, nómina, contabilidad, reportes,
  descargas, configuración, usuarios…), guarda o restablece los predeterminados. La API valida cada ruta con
  `allowPermission` según la tabla de la empresa (`Organization.rolePermissions`, migración
  `20261211000000_add_role_permissions`); sin cambios, los permisos son los de siempre. El propietario siempre tiene
  todo. `/v1/me` devuelve los permisos efectivos y la web oculta las acciones no permitidas.
- **Impresión de la factura: POS o carta.** Al enviar una factura electrónica se elige cómo imprimirla:
  **factura POS** en tirilla para impresora térmica (80 o 58 mm) o **factura electrónica** en hoja carta. Ambas son
  representaciones de la misma factura (número, CUFE y código QR real con los campos de la DIAN). Ruta
  `GET /v1/invoices/:id/print-data`; el botón «Imprimir» permite reimprimir.
- **Configuración › Usuarios y permisos** (`/configuracion/usuarios`): crear usuarios (nombre, correo, celular) con
  un rol (Propietario, Administrador, Contador, Ventas, Soporte o Solo lectura), editarlos, desactivarlos y
  reactivarlos, con la tabla de permisos por rol. Solo Propietario y Administrador gestionan usuarios; solo un
  Propietario asigna ese rol; nadie cambia su rol ni se desactiva; siempre queda un Propietario activo. Desactivar
  quita el acceso al instante (migración `20261210000000_add_membership_active`). En desarrollo, «Probar como» entra
  con otro usuario y el acceso de desarrollo ya respeta el rol asignado.
- **Factura electrónica › AIU** (Administración, Imprevistos y Utilidad): casilla «Incluye AIU» con la configuración
  de la referencia (base AIU sumada o no al total, porcentajes y base de IVA, retefuente y reteICA sobre subtotal,
  base AIU o utilidad). La API recalcula y guarda el AIU con la factura (migración `20261209000000_add_invoice_aiu`),
  el asiento lo incluye en el ingreso y el PDF lo muestra.
- **Reportes › catálogo** con las áreas y secciones de la referencia: 45 reportes nuevos sobre los datos reales
  (ventas por cliente, producto y vendedor, comparativos, obsequios, facturación electrónica, cuentas por cobrar y por
  pagar con corte y por edades, terceros y contactos, compras por proveedor y producto, libros oficiales de compras y
  ventas, saldos de inventario, kárdex, rentabilidad por producto, prima, provisiones, acumulados y seguridad social,
  auxiliar por cuenta, consecutivo de comprobantes, comprobantes no contabilizados, cambios en el patrimonio, libro de
  inventarios y balance, libro mayor, comprobante diario, impuestos detallados, auditoría de anulaciones y
  localidades). Una sola pantalla con filtros, totales y descarga en PDF, Excel y CSV; permisos por reporte en la API.
  Los reportes que aún no se pueden generar muestran el motivo.
- **Menú Reportes** (`/reportes`): centro con enlace a todos los reportes de Betel agrupados por área y dos estados
  financieros nuevos: **estado de resultados** (utilidad bruta, operacional, antes de impuestos y neta, comparado con
  el período anterior) y **estado de situación financiera** (activo = pasivo + patrimonio, con el resultado de los
  años sin cerrar). Descarga en PDF, Excel y CSV; solo OWNER, ADMIN y ACCOUNTANT.
- **Contabilidad › Más procesos** con los 6 grupos de la referencia: **cierre de año** (asiento CIERRE-AAAA contra
  utilidad o pérdida del ejercicio, vista previa, anulación y aviso de cierre desactualizado), **comprobantes
  favoritos** (guardar cualquier comprobante y usarlo como plantilla), **borrado masivo** (anulación de comprobantes
  manuales), **saldos iniciales** de inventario y de otras cuentas (SIC-n) y **certificado de ingresos y retenciones**
  (formato 220) desde la nómina. Los demás procesos muestran el motivo por el que aún no están disponibles.
- **Contabilidad** (nuevo menú lateral): **Cuentas contables** con el árbol del PUC (clase, grupo, cuenta, subcuenta,
  auxiliar), búsqueda por código y nombre, expandir todo, descarga en Excel y panel para ver saldos y crear, editar o
  eliminar cuentas; **Más procesos** con balance de prueba por nivel, libro diario, comprobante contable manual
  (CC-n, cuadrado, con anulación) y accesos a Cajas y bancos, Costeo mensual y Nómina. Ver `docs/contabilidad.md`.

- **Nómina** (nuevo menú lateral, solo propietario, administrador y contador): parámetros legales por año que se
  confirman antes de liquidar, empleados (contrato, salario ordinario o integral, frecuencia, ARL, EPS, pensión),
  liquidación mensual o quincenal con novedades (horas extra, recargos, bonificaciones, retención, descuentos), cálculo
  de IBC, salud, pensión, Fondo de Solidaridad, aportes del empleador y provisiones, aprobación con asiento contable,
  pago (Cajas y bancos), anulación, desprendibles imprimibles y nómina electrónica mensual por el puerto DIAN (en
  pruebas, en cola). Ver `docs/nomina.md`.
- **Cajas y bancos** (nuevo menú lateral): saldo de cada caja (1105) y cuenta bancaria (1110) según la contabilidad,
  con fecha de corte, total general, columnas configurables y descarga; y el **auxiliar** de cada cuenta con saldo
  anterior, entradas, salidas, saldo acumulado y enlace al documento que originó cada movimiento.
  Ver `docs/cajas-y-bancos.md`.
- **Costeo mensual** en Productos y servicios: los 12 meses del año con última ejecución y estado (Sin costear,
  Costeado, Desactualizado, Mes futuro), "Calcular costeo" / "Recalcular" con **costo promedio ponderado** por
  producto y costo de ventas contabilizado (613505/143505, con reversión al recalcular), detalle por producto con
  descarga y "Crear documento". El tablero principal suma el costo de ventas de los meses costeados. Con esto los
  tres submenús de Productos y servicios son funcionales.
- **Documentos de productos / servicios** (inventario): saldo inicial (SI-n) y ajustes de inventario (AJ-n) con
  entradas y salidas a costo unitario, tercero opcional, asiento contable (370505, 429595, 519595 contra 143505) y
  anulación con asiento inverso. Lista con búsqueda por tercero o comprobante, más filtros (últimos 30 días por
  defecto), descarga e importación desde Excel o CSV (todo o nada, con errores por fila). El stock de Gestión de
  productos ahora incluye estos documentos. Búsqueda en `GET /v1/products` y `GET /v1/parties`.
- **Productos y servicios** (nuevo menú lateral) con los submenús Gestión de productos / servicios (funcional),
  Documentos de productos / servicios y Costeo mensual. Gestión: tipo, nombre, código (C-n automático), unidad,
  precios con detalle con IVA, impuestos, **stock** calculado de compras y facturas emitidas (punto rojo si es
  negativo, naranja si es cero), estado; búsqueda, filtros con etiquetas, descarga en Excel, más vendidos, crear,
  editar, duplicar, importar desde Excel o CSV con plantilla, activar o inactivar varios y eliminar si ningún
  documento lo usa. Ver `docs/productos-y-servicios.md`.
- **Soporte por legalizar** en Compras y gastos: importar el XML de la factura electrónica del proveedor (UBL 2.1 o
  AttachedDocument), revisar ítems, totales, proveedor y advertencias, y legalizarla como compra o gasto (crea el
  proveedor si no existe y el CG-n con su asiento) o rechazarla. Criterios de búsqueda (últimos 30 días por defecto),
  descarga en Excel y registro opcional en Registro de eventos. Lector XML propio que rechaza DOCTYPE/entidades.
  Tabla `PurchaseImport` con RLS. Con esto los cuatro submenús de Compras y gastos son funcionales.

- **Proveedores** en Compras y gastos (cuentas por pagar): saldo vencido, por vencer, a favor y total por proveedor,
  búsqueda, más filtros con etiquetas (saldo y estado), columnas, descarga, "Ver reportes" con la antigüedad de
  cuentas por pagar (1–30, 31–60, 61–90, más de 90 días), "Crear Proveedor" y activar/desactivar. **Cuentas por
  pagar** de cada proveedor (`/compras/proveedor`) y **comprobante de egreso** CE-n (`/compras/pago/nuevo`) que abona
  a compras y gastos a crédito, con asiento Proveedores/Caja o Bancos y anulación con asiento inverso. Una compra
  con pagos vigentes no se anula. El tablero suma los pagos a las salidas de caja. Tablas `SupplierPayment` y
  `SupplierPaymentApplication` con RLS.
- **Registro de eventos** en Compras y gastos: registrar facturas electrónicas de proveedores por su CUFE y enviar a la
  DIAN, en orden, la recepción de la factura (030), la recepción de la mercancía o servicio (032) y la aceptación (033)
  o el reclamo con motivo (031) dentro de 3 días hábiles (sin festivos de Colombia); aceptación tácita al vencer el
  plazo. Pestañas Eventos en proceso y finalizados, búsqueda por CUFE, filtros, orden por columna, paginación,
  detalle con historial y "Aprende más". Tablas `ReceivedInvoice` y `ReceivedInvoiceEvent` con RLS; los eventos pasan
  por el puerto DIAN (en pruebas quedan en cola).
- **Compras y gastos** (menú lateral, reemplaza "Documento soporte") con los submenús Documentos de compras y
  gastos, Registro de eventos, Proveedores y Soporte por legalizar. El primero es funcional: lista de compras, gastos
  y documentos soporte con tipo de transacción, más filtros (últimos 15 días por defecto, proveedor, factura del
  proveedor) con etiquetas, descarga PDF/XLSX/CSV, botón dividido "Nueva Compra / Gasto / Doc Soporte", ver, anular y
  contabilizar. Compras y gastos se contabilizan al guardar (inventario o gasto, IVA, caja o proveedores). El tablero
  suma los gastos. Tablas `PurchaseDocument` y `PurchaseLine` con RLS. Ver `docs/compras-y-gastos.md`.
- **Seguimiento comercial** en el Reporte de facturación: tareas comerciales con contacto, compromiso, fecha,
  responsable y oportunidad (etapa, avance, probabilidad, valor esperado, origen, tipo de empresa); criterios de
  búsqueda completos, reporte al pulsar "Buscar", copiar, imprimir, exportar, editar, completar y reabrir.
  Tabla `CommercialTask` con RLS. Con esto las nueve pestañas del reporte tienen datos reales.
- **Clientes** (cartera por cliente) en el Reporte de facturación: saldo vencido, por vencer, a favor y total cartera,
  filtros de saldo y estado con etiquetas, columnas configurables, descarga, crear cliente, activar/desactivar y
  **estado de cuenta** imprimible y enviable por correo (`/clientes/estado-de-cuenta`). Estado del cliente
  `Party.active`. El reporte anterior queda en "Ver reportes → Facturación por cliente".
- **Tablero principal** (Resumen) con datos reales (`GET /v1/dashboard`): ingresos, gastos, utilidad y margen del mes
  con variación frente al mes anterior, evolución de la utilidad por mes, trimestre o año (gráfica de área), flujo de
  caja del mes y accesos rápidos. Reemplaza las cifras de ejemplo que tenía la página.
- **Envío masivo** (impresión y envío masivo de comprobantes): facturas, recibos, cotizaciones y remisiones en una
  lista con criterios (cliente, comprobante, año/mes o rango, estado DIAN, estado del email), selección para
  imprimir (uno por página) o enviar por correo. Las facturas electrónicas solo se envían aprobadas por la DIAN
  (permitido con el proveedor DIAN de pruebas).
- **Facturas recurrentes** en el Reporte de facturación: plantillas con frecuencia, fecha de inicio, número de
  veces y forma de pago (`/facturas-recurrentes/nueva`); generación automática cada hora de facturas en borrador
  con la fecha del día (requisito DIAN), generar ahora, activar/desactivar, historial de facturas generadas y
  pestaña con aviso, filtro de recurrencia, más filtros con etiquetas y descarga. Tablas `RecurringInvoice`,
  `RecurringInvoiceLine` y `RecurringInvoiceRun` con RLS.
- **Remisiones** en el Reporte de facturación: crear remisión (`/remisiones/nueva`) con tipo de transacción, lista
  con buscador de cliente, más filtros (últimos 15 días por defecto, usuario, tipo, estado, correo) con etiquetas,
  descarga, ver e imprimir, enviar por correo, anular y convertir en factura en borrador. Tablas `Delivery` y
  `DeliveryLine` con RLS. "Remisión" en el menú de la cabecera abre el formulario.
- **Cotizaciones** en el Reporte de facturación: crear cotización (`/cotizaciones/nueva`), lista con filtro por
  usuario, más filtros con etiquetas, descarga PDF/XLSX/CSV, ver e imprimir, enviar por correo, anular y
  convertir en factura en borrador. Tablas `Quote` y `QuoteLine` con RLS. "Cotización" en el menú
  "Remisión y cotización" abre el formulario.
- **Gestión de cobro cartera Betel** (pagos en línea): links de pago para facturas a crédito, página pública
  `/pago`, comisión y neto recibido, estados del pago y del desembolso, indicadores con "Filtrar", exportación
  y envío del link por correo. Al aprobarse, el pago crea el recibo de caja y el asiento contable. Pasarela
  conectada por adaptador; hoy solo la de pruebas (`PAYMENT_PROVIDER=sandbox`). Tabla `OnlinePayment` con RLS.
- **Recaudos** en el Reporte de facturación: recibos de caja que abonan a facturas a crédito (asiento contable,
  consecutivo RC-n y anulación con asiento inverso) y lista de recaudos (facturas de contado + recibos) con
  buscador, filtros, indicadores, cartera por cobrar, selección múltiple, exportación y "Ver documento"
  imprimible. Pantallas `/recaudos/nuevo` y `/recaudos/documento`; API en `apps/api/src/collections.ts`.
- Envío de facturas y recibos por correo (SMTP configurable con nodemailer) con registro de cada envío
  (columna "Correo": Enviado / Sin enviar). Mailpit en `docker compose --profile mail` para desarrollo.
- Tablas `CashReceipt`, `CashReceiptApplication` y `DocumentEmail` con RLS (migración
  `20261116000000_add_cash_receipts_and_document_emails`); cuentas 110505 Caja y 111005 Bancos.
- Módulo **Reporte de facturación** (`/reportes/facturacion`) con nueve pestañas. Ventas y Clientes con datos reales:
  filtros, indicadores, gráficas, paginación y exportación a PDF, XLSX y CSV; permisos por rol en la API y
  auditoría de exportaciones. Las demás pestañas indican que su módulo de origen aún no existe
  (ver `docs/reporte-facturacion.md`).
- Cabecera del Reporte de facturación con "Crear factura" y el menú "Remisión y cotización" (sus opciones quedan
  deshabilitadas hasta que existan esos módulos). `AppShell` acepta botones de página en la prop `actions`.
- Cliente HTTP del frontend (`apps/web/lib/api.ts`), con sesión de desarrollo provisional.
- Índice `Invoice(organizationId, customerId, issueDate)` para el reporte por cliente.
- Tareas de VS Code (`.vscode/tasks.json`): iniciar todo al abrir la carpeta, verificar, base de datos, Prisma Studio.
- Configuraciones de depuración (`.vscode/launch.json`) para API, web y pruebas.
- `scripts/instalar-windows.ps1` (instalación completa del entorno) y `scripts/iniciar-base-datos.ps1`.

- Flujo de ramas, revisión mediante Pull Request y validación automática para el trabajo colaborativo.
- Configuración compartida de VS Code, EditorConfig, Prettier (`pnpm format`) y `.gitattributes`.
- Comentarios de documentación en API, contratos, cliente de base de datos, esquema Prisma y frontend.
- Tablero de tareas inicial (`docs/TAREAS.md`) y plantillas de Issues.
- Estándar de comentarios en `CONTRIBUTING.md`.

### Corregido

- Nómina: las provisiones de intereses sobre cesantías, prima y vacaciones usan sus cuentas del PUC (251505, 252005 y
  252505) en lugar de subcuentas de 2510 Cesantías.
- Los errores de negocio de la API (p. ej. factura del proveedor repetida, evento fuera de orden, pago mayor al
  saldo) llegaban a la web como "Conflict" o "Unprocessable Entity": ahora se muestra el mensaje en español.
- Gestión de cobro cartera Betel: los pagos en línea hechos después de las 7 p. m. (hora de Colombia) no aparecían en
  el período del día; el filtro ahora usa días de Colombia.
- Los botones principales y secundarios deshabilitados ahora se ven deshabilitados en toda la aplicación.

### Cambiado

- El isotipo del menú lateral y el ícono del navegador usan el logo oficial "B" de Betel (`public/brand/betel-b.png`,
  `app/icon.png`, con fondo transparente).
- Todos los botones usan el turquesa de la marca (#22D3C5): el principal relleno con texto azul oscuro y los
  secundarios con borde y texto turquesa.
- Nueva identidad visual de Betel Solution: paleta #061724, #0D293B, #22D3C5, #3B82F6, #8B5CF6, #F2F7FA y #9CB3C9
  como variables en `globals.css`, tipografía Inter, isotipo "B" en degradado (también como ícono del navegador),
  menú lateral oscuro con íconos de línea e ítem activo en turquesa, barra superior con la empresa y el NIT reales
  (GET /v1/me) e íconos de línea en la barra y en los accesos rápidos.
- El menú lateral resalta la sección actual en todas sus pantallas (corrige la tarea 1).
- Los artefactos de compilación (`out/`, `apps/web/out/`) dejan de versionarse.
- Dependencias que estaban en `latest` quedan con versión fija.
- El ítem "Facturación" del menú lateral pasa a llamarse "Ventas" (la ruta no cambia).
- "Crear factura" del Reporte de facturación pasa a botón dividido: su flecha despliega Factura recurrente, Nota
  crédito y Nota débito (deshabilitadas hasta que existan esos módulos) y Documento de ingreso (recibo de caja).
- "Remisión y cotización" va después de "Crear factura", con el mismo botón dividido en blanco.
- Las pestañas del Reporte de facturación pasan a estilo subrayado (sin cajas ni separadores).
- La pestaña "Gestión Siigo Pay" del Reporte de facturación pasa a llamarse "Gestión de cobro cartera Betel"
  (`?tab=gestion-cobro`).
- "Ventas" sale del menú lateral: la factura nueva se abre con "Crear factura" en el Reporte de facturación
  (o con "＋ Crear" en la barra superior).
- "Configuración" sale del menú lateral y pasa a un menú desplegable en el engranaje de la barra superior.
- Los desplegables de la barra superior (notificaciones, ajustes, perfil) se animan al abrir y cerrar, se cierran con clic fuera o Escape, y solo uno puede estar abierto a la vez.

## [0.1.0] - 2026-10-26

### Agregado

- Primera entrega de Betel Solution: facturación, terceros, documentos soporte, calendario, notificaciones y contabilidad base.
