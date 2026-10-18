# Geografía colombiana y consulta de identificación

## Estado por fases

| Fase | Estado | Entregable |
| --- | --- | --- |
| 1. Catálogo geográfico | Implementada | 33 departamentos y 1.104 municipios/islas de DIVIPOLA. |
| 2. Código postal asociado | Implementada | 3.681 áreas postales de 4-72 agrupadas por municipio. |
| 3. Autocompletar por identificación | Pendiente bloqueada | Requiere autorización formal DIAN o contrato con proveedor autorizado. |

## Fase 1 y 2: comportamiento implementado

El formulario de tercero presenta primero el selector **Departamento**. Hasta que el usuario no elige una opción, **Ciudad / municipio** permanece deshabilitado. Al escoger un departamento se cargan únicamente sus municipios y ciudades, identificados además con su código DIVIPOLA.

Al elegir el municipio, el formulario obtiene sus códigos postales del catálogo 4-72:

- si existe uno, se muestra como campo de solo lectura;
- si existen varios, se selecciona el primero inicialmente y se habilita un selector para que el usuario elija el que corresponde a la dirección exacta;
- si el catálogo no tiene asociación, se informa al usuario para que confirme la dirección antes de guardar. No se inventa ningún código.

El código DIVIPOLA se conserva como `municipalityCode` y el postal elegido como `postalCode` en el modelo de tercero. La validación exige seis dígitos para el código postal.

### Fuentes y actualización

- Municipios y departamentos: [DIVIPOLA – DANE / Datos Abiertos](https://www.datos.gov.co/Mapas-Nacionales/DIVIPOLA-C-digos-municipios/gdxc-w37w).
- Códigos postales: [Datos abiertos de 4-72](https://www.4-72.com.co/institucional/publicaciones/57/datos-abiertos/) y su [visor oficial](https://visor.codigopostal.gov.co/472/visor/).

El archivo generado es `apps/web/data/colombia-locations.json`. Para actualizarlo con las fuentes oficiales ejecute:

```powershell
corepack pnpm data:locations
corepack pnpm typecheck
corepack pnpm build
```

La sincronización falla deliberadamente si la descarga no contiene al menos 1.100 municipios, 32 departamentos y 3.000 áreas postales; así se evita publicar un catálogo parcial.

## Fase 3 pendiente: autocompletar por identificación

### Resultado de la verificación

El RUT contiene información tributaria y de identificación. La DIAN no publica una API anónima y abierta que permita a cualquier software buscar el perfil completo de un tercero solo enviando su NIT o cédula. El acceso ordinario al RUT es transaccional y requiere usuario autenticado y relación autorizada con el contribuyente.

La DIAN contempla un **Servicio Informático Web Service de consulta permanente del RUT**, pero la entidad debe radicar una solicitud de información junto con los documentos que la DIAN requiera y esperar su estudio y autorización. No se debe automatizar el portal, usar scraping, captchas ni credenciales de un usuario para consultar terceros.

Referencias oficiales:

- [Circular 26 de 2020 de DIAN](https://normograma.dian.gov.co/dian/compilacion/docs/circular_dian_0026_2020.htm), que menciona la solicitud de consulta permanente del RUT mediante Web Service.
- [Información oficial del RUT](https://www.dian.gov.co/tramitesservicios/tramites-y-servicios/tributarios/Paginas/RUT.aspx), que describe las consultas autenticadas y los roles habilitados.

### Paso a paso para obtener los insumos

1. **Definir el caso de uso.** Documente qué datos son estrictamente necesarios para crear un tercero: tipo y número de documento, razón social/nombres, responsabilidades, dirección, municipio y correo si está autorizado. Excluya datos que no se necesiten.
2. **Definir el responsable legal y de protección de datos.** Identifique representante legal, responsable técnico, oficial de privacidad y contador. Prepare la finalidad de tratamiento, base jurídica, periodo de conservación y controles de acceso.
3. **Radicar solicitud ante DIAN.** El representante legal debe solicitar el acceso de consulta permanente del RUT por el canal institucional vigente de DIAN, indicando la organización solicitante, NIT, finalidad, volumen estimado, datos solicitados, responsable y arquitectura de seguridad. Adjunte los soportes que solicite DIAN. La aprobación y condiciones exactas las determina DIAN; no use un endpoint no autorizado mientras espera respuesta.
4. **Obtener el paquete técnico autorizado.** Solicite a DIAN, por escrito, el contrato/convenio o acto de autorización, especificación vigente del Web Service, URL de habilitación y producción, mecanismo de autenticación, certificados, IP permitidas, límites de uso, campos autorizados y política de errores/revocación.
5. **Alternativa con proveedor.** Si se contrata un proveedor tecnológico, obtenga contrato, autorización del proveedor para consulta de terceros, documentación de API, ambiente sandbox, límites, acuerdo de tratamiento de datos y evidencia de su autorización/cobertura frente a DIAN. No se debe asumir que una API comercial tiene acceso legítimo al RUT.
6. **Entregar secretos por canal seguro.** Cuando exista autorización, comparta únicamente mediante el gestor de secretos acordado —nunca por chat, correo plano ni repositorio— las credenciales de sandbox, certificados/llaves, URL base, identificador de cliente y contactos de soporte.
7. **Implementar el adaptador en backend.** Betel configurará secretos por entorno, autenticación mTLS/OAuth según la especificación autorizada, límites de tasa, reintentos seguros, lista de campos permitidos y registros de auditoría sin conservar secretos ni respuestas sensibles completas.
8. **Validar consentimiento y experiencia.** El formulario mostrará la finalidad de la consulta, pedirá la confirmación requerida y permitirá que el usuario revise y edite los datos devueltos antes de guardarlos. Una respuesta externa nunca sobrescribe silenciosamente los datos contables.
9. **Pruebas de habilitación.** Ejecute casos de NIT válido, inexistente, con error de servicio, datos parciales y usuario sin permiso. Valide con el responsable de protección de datos y contador.
10. **Salida a producción y monitoreo.** Active producción solo después de la aprobación técnica/jurídica. Configure alertas de fallos, rotación de certificados, revisión de auditorías y un procedimiento de revocación.

### Insumos que debe entregar la empresa para desbloquear la fase

- Confirmación de autorización/convenio DIAN o contrato con proveedor autorizado.
- Especificación técnica vigente y URLs de sandbox/producción.
- Método de autenticación y alcance de los datos permitidos.
- Certificados/credenciales mediante un gestor de secretos, no en este repositorio ni por chat.
- Identidad del representante legal y responsables de privacidad, seguridad y contabilidad.
- Política de tratamiento de datos, texto de consentimiento y tiempo de retención aprobado.
- NIT de pruebas y casos autorizados para validación.

Hasta recibir esos insumos, el formulario deja visible que el autocompletado está pendiente y no envía números de identificación a ningún servicio externo.
