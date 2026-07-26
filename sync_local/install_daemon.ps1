# =====================================================================
#  install_daemon.ps1 -- Instala sync_ventas_local.py como daemon 24/7
#
#  Crea una tarea del Windows Task Scheduler que:
#    * Se dispara AL BOOT (cuando enciende la PC)
#    * Ejecuta sync_ventas_local.py sin argumentos (modo loop infinito)
#    * Corre como SYSTEM (no depende de usuario logueado)
#    * Se reinicia automaticamente hasta 3 veces si se cae (delay 1 min)
#    * Sin ventana visible (running in background)
#
#  Uso (correr como Administrador):
#    powershell -ExecutionPolicy Bypass -File install_daemon.ps1
#
#  El script auto-detecta:
#    - Ruta de python.exe (usa Get-Command)
#    - Ruta de sync_ventas_local.py (usa $PSScriptRoot)
# =====================================================================

$ErrorActionPreference = 'Stop'

# --- Config ----------------------------------------------------------
$TaskName    = 'SyncVentas_Daemon'
$SyncScript  = "$PSScriptRoot\sync_ventas_local.py"
$LogFile     = "$PSScriptRoot\daemon.log"

Write-Host "=== Instalando daemon SyncVentas ==="
Write-Host "Script: $SyncScript"

# --- Validaciones ----------------------------------------------------
if (-not (Test-Path $SyncScript)) {
    Write-Host "ERROR: no encuentro $SyncScript" -ForegroundColor Red
    exit 1
}

# --- Detectar Python real ---
# En orden de preferencia (evitamos el stub de Microsoft Store):
#   1. C:\Program Files\Python3XX\python.exe (instalacion machine)
#   2. C:\PythonXX\python.exe
#   3. Get-Command (ultimo recurso, puede ser el stub)
$pythonCandidates = @()

# a) Python instalado a nivel machine (accesible para SYSTEM)
$pythonCandidates += Get-ChildItem "C:\Program Files\Python*\python.exe" -ErrorAction SilentlyContinue |
    Sort-Object { $_.Directory.Name } -Descending

# b) Python en C:\PythonXX
$pythonCandidates += Get-ChildItem "C:\Python*\python.exe" -ErrorAction SilentlyContinue |
    Sort-Object { $_.Directory.Name } -Descending

# c) Ultimo recurso: Get-Command (excluir el stub)
$pathPython = Get-Command python.exe -ErrorAction SilentlyContinue
if ($pathPython -and $pathPython.Source -notlike "*WindowsApps*") {
    $pythonCandidates += Get-Item $pathPython.Source
}

$pythonPath = $null
foreach ($cand in $pythonCandidates) {
    if ($cand.FullName -notlike "*WindowsApps*") {
        $pythonPath = $cand.FullName
        break
    }
}

if (-not $pythonPath) {
    Write-Host "ERROR: no encuentro Python real. Instalar con:" -ForegroundColor Red
    Write-Host "  winget install --id Python.Python.3.12 --scope machine" -ForegroundColor Yellow
    exit 1
}
Write-Host "Python: $pythonPath"

# --- Borrar task anterior si existe ---------------------------------
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Borrando task anterior '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# --- Detectar pythonw.exe (version sin ventana, para daemons) -------
# pythonw NO abre ventana negra. Ideal para daemons.
$pythonwPath = Join-Path (Split-Path $pythonPath) 'pythonw.exe'
if (Test-Path $pythonwPath) {
    Write-Host "Usando pythonw.exe (sin ventana): $pythonwPath"
    $pythonToUse = $pythonwPath
} else {
    Write-Host "ATENCION: pythonw.exe no encontrado, usando python.exe (mostrara ventana)"
    $pythonToUse = $pythonPath
}

# --- Borrar .bat viejo si existe (ya no lo necesitamos) -------------
$BatFile = "$PSScriptRoot\_run_daemon.bat"
if (Test-Path $BatFile) {
    Remove-Item $BatFile -Force
}

# --- Configurar action ----------------------------------------------
# Ejecutamos pythonw.exe DIRECTAMENTE (sin .bat / cmd.exe de por medio).
# pythonw no abre ventana. El sync tiene su propio logging a sync.log.
# Los errores no manejados se pierden (aceptable, van al sync.log ademas).
$action = New-ScheduledTaskAction `
    -Execute $pythonToUse `
    -Argument "`"$SyncScript`"" `
    -WorkingDirectory $PSScriptRoot

# Detectar el usuario actual (el que tiene permisos en SQL Server Dragonfish)
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
Write-Host "Usuario para la task: $currentUser"

# Trigger: al iniciar sesion del user actual (se dispara cada vez que ese
# user logea en Windows). Como en la PC del local siempre queda la sesion
# abierta, con esto arranca al boot inicial y persiste.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

# Settings: auto-restart, no tiene time limit, no wake computer
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

# Principal: correr como el usuario actual (que tiene permisos en Dragonfish).
# LogonType Interactive = corre solo cuando ese user esta logueado en Windows.
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Highest

# --- Registrar la task -----------------------------------------------
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Daemon del sync de ventas de Dragonfish. Polea dragonfish_jobs cada 60s.' | Out-Null

Write-Host "OK Task '$TaskName' creada."

# --- Arrancar ya (sin esperar a reboot) -----------------------------
Write-Host "Arrancando el daemon ahora..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

# --- Verificar que arranco ------------------------------------------
$state = (Get-ScheduledTask -TaskName $TaskName).State
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ""
Write-Host "Estado de la task: $state"
Write-Host "Ultima ejecucion: $($info.LastRunTime)"
Write-Host "Ultimo resultado: 0x$('{0:X}' -f $info.LastTaskResult) (0 = OK, o corriendo)"

$pyProc = Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $pythonPath }
if ($pyProc) {
    Write-Host ""
    Write-Host "python.exe corriendo:" -ForegroundColor Green
    $pyProc | Format-Table Id, StartTime, WorkingSet, Path -AutoSize
} else {
    Write-Host ""
    Write-Host "ATENCION: no veo python.exe corriendo. Revisar $LogFile" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Setup completo ==="
Write-Host "Log del daemon: $LogFile"
Write-Host ""
Write-Host "Para verificar que funciona:"
Write-Host "  - Get-Content '$LogFile' -Tail 20 -Wait     # ver logs en vivo"
Write-Host "  - schtasks /query /tn '$TaskName' /v         # detalle de la task"
Write-Host "  - Get-Process python                         # ver que este corriendo"
Write-Host ""
Write-Host "Para detener/reiniciar:"
Write-Host "  - Stop-ScheduledTask -TaskName '$TaskName'   # detener"
Write-Host "  - Start-ScheduledTask -TaskName '$TaskName'  # iniciar"
