# Guía de colaboración

Este repositorio usa Git y Pull Requests para que el trabajo de cada integrante sea trazable, revisable y recuperable.

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
