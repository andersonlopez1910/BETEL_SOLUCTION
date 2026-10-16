# Prueba humana de Betel Solution

## Propósito y alcance

Validar navegación, legibilidad, adaptación móvil y consistencia visual de la interfaz privada desplegada. Esta prueba no autoriza transmisión DIAN ni uso de información real: el sitio publicado es una exportación estática de UX sin API pública conectada.

## Preparación

1. Abra la URL privada de despliegue en escritorio y en un navegador móvil o con emulación de 390 px de ancho.
2. Use datos ficticios. No ingrese certificados, contraseñas, RUT ni datos personales reales.
3. Verifique que la etiqueta o documentación del entorno indique que corresponde a revisión, no a producción fiscal.

## Casos de aceptación de interfaz

| ID | Recorrido | Resultado esperado |
| --- | --- | --- |
| HT-01 | Abra **Resumen** y navegue con el menú lateral. | Se muestran tarjetas de acciones, métricas y actividades sin solapamientos. |
| HT-02 | Abra **Nueva factura**. Agregue y quite una línea; cambie cantidades, descuento e IVA. | Totales, subtotal e IVA cambian de forma coherente; los botones quedan visibles. |
| HT-03 | Abra **Nuevo documento soporte** y repita la edición de líneas. | Se diferencia visualmente de factura y permite ver las formas de pago. |
| HT-04 | Abra **Crear tercero** y recorra datos básicos, facturación y contactos. | Los campos, responsabilidades y acciones son comprensibles y no se cortan. |
| HT-05 | Abra **Calendario** y revise eventos y leyenda. | La cuadrícula conserva encabezados, horas y colores a 390 px y en escritorio. |
| HT-06 | Abra las notificaciones desde la campana y después la página de notificaciones. | El panel se abre/cierra, conserva jerarquía y presenta estados de lectura. |
| HT-07 | Abra **Configuración** y cambie cada categoría. | Las opciones cambian de contenido y el estado seleccionado se entiende. |
| HT-08 | Abra **Cuenta** y sus pestañas, luego **Mi perfil** desde el avatar. | Se visualizan pagos, plan, documentos legales y perfil sin pérdida de contenido. |
| HT-09 | Repita HT-01 a HT-08 en móvil. | El menú se compacta, no hay desplazamiento horizontal innecesario y todos los controles se pueden tocar. |

## Registro de resultados

Para cada fallo capture: ID de caso, URL/ruta, dispositivo y navegador, pasos, resultado observado, resultado esperado y captura sin datos reales. Clasifique como bloqueante, alto, medio o bajo.

## Validación local de API (equipo técnico)

La API se valida separadamente antes de una puesta en producción. Con Docker y `.env` configurados:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm --filter @betel/api dev
```

Los recorridos de integración deben confirmar, como mínimo: creación y emisión de factura y documento soporte, dos comprobantes contables balanceados, notificaciones creadas, `401` sin JWT y cero registros de una organización al consultar con el token de otra. El endpoint de sesión de desarrollo solo debe existir en entorno local con `BETEL_ALLOW_INSECURE_DEV_AUTH=true`.
