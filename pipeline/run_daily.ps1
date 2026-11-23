# Carga diaria SAP HANA -> BigQuery de cada entidad y cuadre de filas contra HANA.
# - Lunes a sabado: incremental (documentos de los ultimos 7 dias + catalogos completos), ~2 min por entidad.
# - Domingo (o con -Full): carga completa (replace), ~14 min en total; corrige lo que el incremental no ve (p. ej. borrados).
# La corre la tarea programada "Fronterra - carga SAP a BigQuery" (ver register_daily_task.ps1); tambien se puede correr a mano.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File run_daily.ps1                 # FGI y FASA (incremental o completa segun el dia)
#   powershell -NoProfile -ExecutionPolicy Bypass -File run_daily.ps1 -Entities fgi   # solo FGI (prueba rapida)
#   powershell -NoProfile -ExecutionPolicy Bypass -File run_daily.ps1 -Full           # forzar carga completa
#   powershell -NoProfile -ExecutionPolicy Bypass -File run_daily.ps1 -Days 30        # ventana mas amplia (tras dias sin cargar)
#   powershell -NoProfile -ExecutionPolicy Bypass -File run_daily.ps1 -SkipDbt        # solo cargas, sin dbt
#
# Despues de las cargas, si ninguna fallo: dbt build --target prod (modelos, fotos diarias y pruebas; pipeline\dbt).
# Log: pipeline\logs\AAAA-MM-DD.log (fuera de Git; se borran los de mas de 60 dias).
# Codigo de salida: 0 todo bien, 1 fallo una carga (dbt no corre), 3 fallo dbt (algun modelo o prueba),
#                   2 cargas y dbt OK pero algun cuadre de filas no cuadra.
# Este archivo no lleva acentos: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.

param(
    [ValidateSet('fgi', 'fasa')]
    [string[]]$Entities = @('fgi', 'fasa'),
    [switch]$Full,
    [int]$Days = 7,
    [switch]$SkipDbt,
    [string]$DbtPython = 'C:\Users\ftruser16\dbt-venv\Scripts\python.exe',
    [int]$KeepLogDays = 60
)

$ErrorActionPreference = 'Continue'   # dlt escribe su bitacora en stderr; con 'Stop' PowerShell 5.1 la trataria como error
Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = 'utf-8'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ((Get-Date -Format 'yyyy-MM-dd') + '.log')

function Write-Log([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    $line | Out-File -FilePath $log -Append -Encoding utf8
    Write-Host $line   # Write-Host y no Write-Output: lo escrito al pipeline se mezclaria con el valor que devuelve Invoke-Step
}

function Invoke-Step([string]$name, [string[]]$arguments, [string]$exe = $python) {
    Write-Log "INICIO $name"
    $t0 = Get-Date
    & $exe @arguments 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8
    $code = $LASTEXITCODE
    $min = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
    if ($code -eq 0) { Write-Log "OK     $name ($min min)" } else { Write-Log "ERROR  $name (codigo $code, $min min)" }
    return $code
}

if (-not (Test-Path $python)) {
    Write-Log "ERROR  no existe $python (crear el venv, ver pipeline\CLAUDE.md)"
    exit 1
}

$isFull = $Full -or ((Get-Date).DayOfWeek -eq 'Sunday')
$mode = if ($isFull) { 'completa' } else { "incremental $Days dias" }
Write-Log ("===== Carga diaria ($mode): " + ($Entities -join ', ') + " =====")
$loadFailed = $false
$checkFailed = $false

foreach ($e in $Entities) {
    $loadArgs = @('hana_pipeline.py', '--entity', $e)
    if (-not $isFull) { $loadArgs += @('--incremental', '--days', "$Days") }
    $code = Invoke-Step "carga $e ($mode)" $loadArgs
    if ($code -ne 0) { $loadFailed = $true; continue }   # sin carga no tiene caso cuadrar esa entidad
    $code = Invoke-Step "cuadre de filas $e" @('check_counts.py', '--entity', $e)
    if ($code -ne 0) { $checkFailed = $true }
}

# dbt solo sobre cargas completas y correctas: si una carga fallo, las fotos del dia quedarian con datos viejos
$dbtFailed = $false
if (-not $SkipDbt -and -not $loadFailed) {
    if (-not (Test-Path $DbtPython)) {
        Write-Log "ERROR  no existe $DbtPython (venv de dbt, ver pipeline\CLAUDE.md)"
        $dbtFailed = $true
    } else {
        $code = Invoke-Step 'dbt build prod' @((Join-Path $PSScriptRoot 'dbt\run_dbt.py'), 'build', '--target', 'prod') $DbtPython
        if ($code -ne 0) { $dbtFailed = $true }
    }
}

# Limpieza de logs viejos
Get-ChildItem $logDir -Filter '*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepLogDays) } | Remove-Item -Force

if ($loadFailed) { Write-Log '===== TERMINO CON ERRORES DE CARGA (dbt no corrio) ====='; exit 1 }
if ($dbtFailed) { Write-Log '===== CARGAS OK, PERO FALLO DBT (revisar el log) ====='; exit 3 }
if ($checkFailed) { Write-Log '===== CARGAS OK, PERO ALGUN CUADRE NO CUADRA (revisar el log) ====='; exit 2 }
Write-Log '===== TERMINO OK ====='
exit 0
