# Registra (o actualiza) la tarea programada de Windows que corre run_daily.ps1 cada dia.
# Correrlo UNA vez, a mano, en una consola de PowerShell como administrador, en el servidor:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File register_daily_task.ps1              # diario a las 05:00
#   powershell -NoProfile -ExecutionPolicy Bypass -File register_daily_task.ps1 -At 04:30    # otra hora
#
# Pide usuario y contrasena de Windows en una ventana propia de Windows: la contrasena la guarda el Programador de
# tareas (para correr aunque nadie haya iniciado sesion) y no queda en ningun archivo.
# La cuenta debe poder leer pipeline\.dlt\secrets.toml y la carpeta del venv.
# Este archivo no lleva acentos: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.

param(
    [string]$At = '05:00',
    [string]$TaskName = 'Fronterra - carga SAP a BigQuery'
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'run_daily.ps1'
if (-not (Test-Path $script)) { throw "No existe $script" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
    -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -StartWhenAvailable `
    -RestartCount 1 -RestartInterval (New-TimeSpan -Minutes 30)

$cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" -Message "Cuenta de Windows que correra la carga diaria"
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited `
    -Description 'Carga SAP HANA (FASA_PROD, FGI_PROD) a BigQuery raw_sap_fasa / raw_sap_fgi y cuadre de filas. Log en pipeline\logs.' `
    -Force | Out-Null

Write-Output "Tarea '$TaskName' registrada: diario a las $At como $($cred.UserName)."
Write-Output "Probar ya:      Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "Ver resultado:  Get-ScheduledTaskInfo -TaskName '$TaskName'   (LastTaskResult 0 = OK, 1 = fallo carga, 2 = no cuadra)"
