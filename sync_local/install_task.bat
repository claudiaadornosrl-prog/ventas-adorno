@echo off
:: ═════════════════════════════════════════════════════════════
::  Instala sync_ventas_local como tarea programada de Windows
::  que arranca al iniciar la PC y se reinicia si crashea.
:: ═════════════════════════════════════════════════════════════

cd /d "%~dp0"

set TASK_NAME=Ventas_Adorno_SyncLocal
set SCRIPT_PATH=%~dp0sync_ventas_local.py
set PYTHON_PATH=python.exe

:: 1. Borrar la tarea previa si existe (para reinstalar)
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

:: 2. Crear la tarea: al login + reinicio cada minuto si muere
schtasks /Create /TN "%TASK_NAME%" ^
    /SC ONLOGON ^
    /RL HIGHEST ^
    /TR "\"%PYTHON_PATH%\" \"%SCRIPT_PATH%\"" ^
    /F

if %errorlevel% neq 0 (
    echo.
    echo ❌ ERROR al crear la tarea. Probá ejecutar este .bat como Administrador.
    pause
    exit /b 1
)

echo.
echo ✓ Tarea programada creada: %TASK_NAME%
echo.
echo Para arrancar ahora sin esperar al reinicio:
echo    schtasks /Run /TN "%TASK_NAME%"
echo.
echo Para ver el log:
echo    type "%~dp0sync.log"
echo.
echo Para sacar la tarea:
echo    schtasks /Delete /TN "%TASK_NAME%" /F
echo.
pause
