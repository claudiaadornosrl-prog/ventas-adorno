# =====================================================================
#  install_watchdog.ps1 -- Crea la tarea SyncVentas_Watchdog
#
#  Problema que resuelve: el SyncVentas_Daemon a veces queda zombie
#  (figura "Running" pero no sincroniza — pasó en Unicenter el 24-jul-2026).
#  El watchdog lo mata y lo relanza todos los días a las 6:30 AM,
#  antes de que abran los locales, para que arranque el día fresco.
#
#  Uso (PowerShell como Administrador, en CADA server):
#    powershell -ExecutionPolicy Bypass -File install_watchdog.ps1
#
#  Es idempotente: si la tarea ya existe, la reemplaza (-Force).
# =====================================================================

$ErrorActionPreference = 'Stop'

$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument '/c schtasks /End /TN SyncVentas_Daemon & timeout /t 15 /nobreak & schtasks /Run /TN SyncVentas_Daemon'

$trigger = New-ScheduledTaskTrigger -Daily -At 6:30AM

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName 'SyncVentas_Watchdog' `
  -Action $action -Trigger $trigger -Settings $settings `
  -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

Write-Host "OK: SyncVentas_Watchdog creado (diario 6:30 AM, reinicia SyncVentas_Daemon)" -ForegroundColor Green
Get-ScheduledTask -TaskName 'SyncVentas_Watchdog' | Format-List TaskName, State
