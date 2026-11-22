# ════════════════════════════════════════════════════════════════════════════
#  Instalación del entorno de desarrollo de Betel Solution (Windows)
#  Se puede ejecutar varias veces sin problema: solo hace lo que falte.
#  Uso: clic derecho > "Ejecutar con PowerShell", o desde la terminal de VS Code:
#       powershell -ExecutionPolicy Bypass -File scripts/instalar-windows.ps1
#  Registro completo en %TEMP%\betel-instalacion-log.txt
# ════════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot   # Raíz del repositorio (este script vive en scripts/)
Start-Transcript -Path (Join-Path $env:TEMP 'betel-instalacion-log.txt') -Force | Out-Null
$errores = @()
function Paso($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  OK  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  ERROR  $t" -ForegroundColor Red; $script:errores += $t }
function Refrescar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}

Set-Location $repo
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'   # Evita que corepack pregunte "¿descargar pnpm?"

# ── 1. Node.js (22 o superior) ───────────────────────────────────────────────
Paso '1. Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '  Node.js no está instalado. Instalando la versión LTS con winget (acepta el permiso de Windows si aparece)...'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Refrescar-Path
}
if (Get-Command node -ErrorAction SilentlyContinue) {
  $v = (node -v); $mayor = [int]($v.TrimStart('v').Split('.')[0])
  if ($mayor -ge 22) { Ok "Node $v" } else { Mal "Node $v es muy antiguo; se necesita 22 o superior (instala la LTS desde nodejs.org)" }
} else { Mal 'No se pudo instalar Node.js. Instálalo desde https://nodejs.org (versión LTS) y vuelve a ejecutar.'; Stop-Transcript; Read-Host 'Enter para salir'; exit 1 }

# ── 2. Corepack / pnpm ───────────────────────────────────────────────────────
Paso '2. pnpm (vía corepack)'
if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) { npm install -g corepack; Refrescar-Path }
corepack pnpm --version
if ($LASTEXITCODE -eq 0) { Ok 'pnpm disponible' } else { Mal 'corepack/pnpm no funciona' }

# ── 3. Variables de entorno locales (.env, nunca se suben a Git) ─────────────
Paso '3. Archivos .env'
$envRaiz = Join-Path $repo '.env'
if (-not (Test-Path $envRaiz)) {
  $secreto = -join ((48..57) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  (Get-Content (Join-Path $repo '.env.example') -Raw) `
    -replace 'JWT_SECRET=".*"', "JWT_SECRET=`"$secreto`"" `
    -replace 'BETEL_ALLOW_INSECURE_DEV_AUTH=".*"', 'BETEL_ALLOW_INSECURE_DEV_AUTH="true"' |
    Set-Content $envRaiz -Encoding ascii
  Ok '.env creado (secreto JWT aleatorio y login de desarrollo activado)'
} else { Ok '.env ya existía (no se modificó)' }
# Prisma (migraciones/RLS) usa el usuario administrador "betel"; la API usa "betel_app".
$envDb = Join-Path $repo 'packages\db\.env'
if (-not (Test-Path $envDb)) {
  'DATABASE_URL="postgresql://betel:betel_local@localhost:5433/betel?schema=public"' | Set-Content $envDb -Encoding ascii
  Ok 'packages\db\.env creado (usuario administrador local)'
} else { Ok 'packages\db\.env ya existía' }

# ── 4. Dependencias del proyecto ─────────────────────────────────────────────
Paso '4. Dependencias (pnpm install) - puede tardar unos minutos'
corepack pnpm install
if ($LASTEXITCODE -eq 0) { Ok 'Dependencias instaladas' } else { Mal 'pnpm install falló' }
corepack pnpm db:generate
if ($LASTEXITCODE -eq 0) { Ok 'Cliente Prisma generado' } else { Mal 'prisma generate falló' }

# ── 5. Extensiones de VS Code ────────────────────────────────────────────────
Paso '5. Extensiones de VS Code'
if (Get-Command code -ErrorAction SilentlyContinue) {
  foreach ($ext in 'esbenp.prettier-vscode','Prisma.prisma','eamodio.gitlens','GitHub.vscode-pull-request-github',
                   'dbaeumer.vscode-eslint','EditorConfig.EditorConfig','MS-CEINTL.vscode-language-pack-es') {
    code --install-extension $ext --force | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok $ext } else { Mal "Extensión $ext" }
  }
} else { Mal 'No se encontró el comando "code". En VS Code: Ctrl+Shift+P > "Shell Command: Install code command in PATH"' }

# ── 6. Base de datos PostgreSQL en Docker ────────────────────────────────────
Paso '6. Base de datos (Docker)'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Mal 'Docker no está instalado o no está en el PATH. Instala Docker Desktop y vuelve a ejecutar este script.'
} else {
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  Docker Desktop no está corriendo; iniciándolo (espera hasta 3 minutos)...'
    # Docker Desktop puede estar instalado para todos los usuarios o solo para el actual.
    $rutas = @((Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
               (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'))
    $exe = $rutas | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($exe) { Start-Process $exe } else { Write-Host '  No encontré Docker Desktop.exe; ábrelo manualmente.' }
    for ($i = 0; $i -lt 36; $i++) { Start-Sleep 5; docker info *> $null; if ($LASTEXITCODE -eq 0) { break } }
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Mal 'Docker no respondió. Abre Docker Desktop, espera a que diga "Engine running" y ejecuta de nuevo este script.'
  } else {
    Ok 'Docker funcionando'
    docker compose up -d postgres
    $estado = ''
    for ($i = 0; $i -lt 30; $i++) {
      $estado = (docker inspect --format '{{.State.Health.Status}}' betel-postgres 2>$null)
      if ($estado -eq 'healthy') { break }; Start-Sleep 2
    }
    if ($estado -eq 'healthy') {
      Ok 'PostgreSQL listo en el puerto 5433'
      corepack pnpm db:push
      if ($LASTEXITCODE -eq 0) { Ok 'Tablas creadas' } else { Mal 'db:push falló' }
      corepack pnpm db:rls
      if ($LASTEXITCODE -eq 0) { Ok 'Seguridad RLS aplicada' } else { Mal 'db:rls falló' }
    } else { Mal "PostgreSQL no quedó listo (estado: $estado)" }
  }
}

# ── 7. Verificación ──────────────────────────────────────────────────────────
Paso '7. Verificación (tipos y pruebas)'
corepack pnpm typecheck
if ($LASTEXITCODE -eq 0) { Ok 'typecheck' } else { Mal 'typecheck' }
corepack pnpm test
if ($LASTEXITCODE -eq 0) { Ok 'pruebas' } else { Mal 'pruebas' }

# ── Resumen ──────────────────────────────────────────────────────────────────
Paso 'RESUMEN'
if ($errores.Count -eq 0) {
  Write-Host '  TODO LISTO. Para trabajar:' -ForegroundColor Green
  Write-Host '    1. Abre la carpeta BETEL_SOLUCTION en VS Code.'
  Write-Host '    2. Terminal (Ctrl+ñ):  corepack pnpm dev'
  Write-Host '    3. Web: http://localhost:3000   API: http://localhost:4000/health'
} else {
  Write-Host '  Terminó con estos problemas:' -ForegroundColor Yellow
  $errores | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
}
Write-Host 'INSTALACION-TERMINADA'
Stop-Transcript | Out-Null
Read-Host "`nPresiona Enter para cerrar"
