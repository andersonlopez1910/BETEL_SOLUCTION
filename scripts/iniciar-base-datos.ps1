# ════════════════════════════════════════════════════════════════════════════
#  Inicia la base de datos local en Windows (lo usa la tarea de VS Code
#  "Betel: base de datos").
#   1. Si Docker no responde, abre Docker Desktop y espera hasta 3 minutos.
#   2. Levanta el contenedor PostgreSQL definido en docker-compose.yml.
# ════════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Continue'

function Docker-Listo { docker info *> $null; return ($LASTEXITCODE -eq 0) }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Docker no está instalado. Instala Docker Desktop: https://www.docker.com/products/docker-desktop/' -ForegroundColor Red
  exit 1
}

if (-not (Docker-Listo)) {
  Write-Host 'Docker Desktop no está corriendo; iniciándolo...'
  # Docker Desktop puede estar instalado para todos los usuarios o solo para el actual.
  $rutas = @((Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
             (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'))
  $exe = $rutas | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($exe) { Start-Process $exe }
  for ($i = 0; $i -lt 36 -and -not (Docker-Listo); $i++) { Start-Sleep 5 }
}

if (-not (Docker-Listo)) {
  Write-Host 'Docker no respondió. Abre Docker Desktop, espera "Engine running" y vuelve a ejecutar la tarea.' -ForegroundColor Red
  exit 1
}

docker compose up -d --wait postgres
if ($LASTEXITCODE -ne 0) { Write-Host 'No se pudo iniciar PostgreSQL.' -ForegroundColor Red; exit 1 }
Write-Host 'PostgreSQL listo en el puerto 5433.' -ForegroundColor Green
