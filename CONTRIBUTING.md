# Guía de colaboración

Este repositorio usa Git y Pull Requests para que el trabajo de cada integrante sea trazable, revisable y recuperable.

## Primer día en el proyecto

1. Instale Git, Node.js 22+, Docker Desktop y Visual Studio Code.
2. Clone el repositorio y ábralo en VS Code; acepte instalar las **extensiones recomendadas** (`.vscode/extensions.json`).
3. **Windows:** ejecute `scripts/instalar-windows.ps1` (clic derecho → _Ejecutar con PowerShell_). Instala lo que
   falte (Node, dependencias, extensiones de VS Code, `.env`, base de datos en Docker) y verifica el proyecto.
   En otros sistemas siga la sección _Inicio local_ del [README](README.md).
4. Abra la carpeta en VS Code: la tarea **Betel: iniciar todo** arranca sola la base de datos, la web y la API
   (la primera vez acepte "Permitir tareas automáticas"). Vea [Trabajo diario en VS Code](#trabajo-diario-en-vs-code).
5. Revise el tablero de tareas ([docs/TAREAS.md](docs/TAREAS.md) y GitHub Projects) y tome un Issue sin responsable.

## Trabajo diario en VS Code

Todo se maneja desde VS Code con las tareas de `.vscode/tasks.json` (`Ctrl+Shift+P` → _Tasks: Run Task_):

| Tarea / atajo                                       | Qué hace                                                       |
| --------------------------------------------------- | -------------------------------------------------------------- |
| **Betel: iniciar todo** (`Ctrl+Shift+B`)            | Docker + PostgreSQL y luego web (3000) + API (4000).           |
| **Betel: abrir en el navegador**                    | Abre http://localhost:3000.                                    |
| **Betel: verificar (tipos + pruebas)**              | Lo mismo que revisa el CI. Ejecútela antes de cada PR.         |
| **Betel: instalar dependencias**                    | Después de un `git pull` que cambie dependencias o el esquema. |
| **Betel: actualizar base de datos (esquema + RLS)** | Aplica cambios de `schema.prisma` a la base local.             |
| **Betel: ver datos (Prisma Studio)**                | Explorador visual de la base en http://localhost:5555.         |
| **Betel: formatear todo el código**                 | Prettier sobre todo el repositorio.                            |

Depuración (`F5`, panel _Ejecutar y depurar_): **Depurar API**, **Depurar web**, **Depurar web + API** y
**Ejecutar pruebas de la API**, con puntos de interrupción en el código TypeScript.

Git también se usa desde VS Code: panel _Control de código fuente_ (`Ctrl+Shift+G`) para commits, la rama
actual abajo a la izquierda y la extensión _GitHub Pull Requests_ para abrir y revisar PRs.

## Tareas y tablero

- Todo trabajo nace de un **Issue** (plantillas en `.github/ISSUE_TEMPLATE`) con **un solo responsable**.
- No se trabaja en un módulo cuyo Issue esté "En progreso" con otra persona.
- La rama lleva el número del Issue: `feature/12-listado-terceros`; el PR incluye `Closes #12`.

## Ramas

- `master`: versión estable. No se hacen commits directos.
- `develop`: rama de integración del equipo. No se hacen commits directos.
- `feature/<descripcion-corta>`: funcionalidad nueva, creada desde `develop`.
- `fix/<descripcion-corta>`: corrección normal, creada desde `develop`.
- `hotfix/<descripcion-corta>`: corrección urgente, creada desde `master` y luego integrada también en `develop`.

Ejemplo:

```powershell
git switch develop
git pull origin develop
git switch -c feature/factura-electronica
```

## Flujo de trabajo

1. Actualice `develop` antes de crear una rama.
2. Mantenga cada rama enfocada en una sola tarea.
3. Haga commits pequeños con mensajes convencionales: `feat:`, `fix:`, `docs:`, `refactor:`, `test:` o `chore:`.
4. Antes de publicar, ejecute `corepack pnpm typecheck` y las pruebas pertinentes.
5. Publique la rama y abra un Pull Request hacia `develop`.
6. Una persona distinta al autor revisa y aprueba el Pull Request. Resuelva los comentarios antes de fusionarlo.
7. Solo los cambios ya integrados y verificados en `develop` pasan a `master` mediante Pull Request de versión.

Nunca se deben subir secretos ni datos reales: `.env`, certificados, RUT, llaves privadas o exportaciones de bases de datos están prohibidos.

Tampoco se suben archivos generados (`out/`, `.next/`, `dist/`): se crean con `corepack pnpm build`.

## Formato del código

- VS Code formatea al guardar con Prettier (configuración en `.prettierrc.json`).
- Para formatear todo manualmente: `corepack pnpm format`. Para verificar: `corepack pnpm format:check`.
- No mezcle en un mismo commit cambios de formato con cambios de lógica.

## Estándar de comentarios

Los comentarios se escriben **en español** y explican el **porqué**, no repiten lo que el código ya dice.

1. **Encabezado de archivo** (`/** ... */`): qué contiene el archivo y cómo se usa.
2. **Funciones, componentes y rutas exportadas**: JSDoc con propósito, parámetros relevantes,
   roles permitidos (en rutas de API) y efectos secundarios (auditoría, asientos contables, etc.).
3. **Reglas de negocio** (impuestos, partida doble, DIAN): siempre comentadas, con la fórmula o la cuenta PUC.
4. **Marcadores**:
   - `PENDIENTE:` funcionalidad por construir (debe tener un Issue).
   - `OBSERVACIÓN:` comportamiento a revisar o bug conocido.
   - `IMPORTANTE:` algo que puede romper el sistema si se cambia sin cuidado.
5. **Modelos Prisma**: comentario `///` encima de cada `model` o `enum` (aparece al pasar el mouse en VS Code).

Ejemplo:

```ts
/**
 * POST /v1/parties — Crea un tercero. Body: partySchema (@betel/contracts).
 * Roles: OWNER, ADMIN, ACCOUNTANT, SALES. Registra AuditLog "CREATE".
 */
```

## Versiones y entregas

Se usa versionado semántico: `MAYOR.MENOR.PARCHE`.

- `MAYOR`: cambio incompatible.
- `MENOR`: funcionalidad compatible nueva.
- `PARCHE`: corrección compatible.

Cada entrega a `master` debe actualizar `CHANGELOG.md`, indicar la versión y llevar una etiqueta Git, por ejemplo:

```powershell
git switch master
git pull origin master
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```
