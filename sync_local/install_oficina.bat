@echo off
chcp 65001 > NUL
title Instalacion sync_ventas_local - OFICINA
:: ════════════════════════════════════════════════════════════
::  Setup automatico de sync_ventas_local en el SERVER de Oficina
::  Pasos: verifica Python, instala deps, configura .env, crea tarea
:: ════════════════════════════════════════════════════════════

cd /d "%~dp0"

echo.
echo ══════════════════════════════════════════════════════════
echo   Instalacion sync_ventas_local - OFICINA
echo ══════════════════════════════════════════════════════════
echo.
echo Este script va a:
echo   1. Verificar que Python este instalado
echo   2. Instalar las dependencias (pyodbc + requests)
echo   3. Crear el archivo .env precargado para OFICINA
echo   4. Pedir la SUPABASE_SERVICE_KEY (la pegas vos)
echo   5. Crear la tarea programada de Windows
echo.
echo IMPORTANTE: ejecutame como Administrador (boton derecho - Ejecutar como admin)
echo.
pause

:: ── 1) Verificar Python ─────────────────────────────────────
echo.
echo [1/5] Verificando Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python no esta instalado o no esta en PATH.
    echo    Descargar desde https://www.python.org/downloads/ (version 3.8 o superior)
    echo    Tildar "Add Python to PATH" durante la instalacion.
    pause
    exit /b 1
)
python --version
echo OK.

:: ── 2) Instalar dependencias ───────────────────────────────
echo.
echo [2/5] Instalando dependencias (pyodbc + requests)...
python -m pip install --upgrade pip >nul
python -m pip install pyodbc requests
if %errorlevel% neq 0 (
    echo ❌ Error instalando dependencias. Probar manualmente:
    echo    python -m pip install pyodbc requests
    pause
    exit /b 1
)
echo OK.

:: ── 3) Verificar ODBC Driver ───────────────────────────────
echo.
echo [3/5] Verificando ODBC Driver for SQL Server...
reg query "HKLM\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers" /v "ODBC Driver 17 for SQL Server" >nul 2>&1
if %errorlevel% neq 0 (
    reg query "HKLM\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers" /v "ODBC Driver 18 for SQL Server" >nul 2>&1
    if %errorlevel% neq 0 (
        echo ⚠ No se detecto ODBC Driver 17/18 for SQL Server.
        echo   Descargalo de:
        echo   https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server
        echo   y volve a correr este script.
        pause
        exit /b 1
    )
)
echo OK.

:: ── 4) Crear .env ──────────────────────────────────────────
echo.
echo [4/5] Configurando archivo .env para OFICINA...
if exist .env (
    echo.
    echo ⚠ Ya existe un archivo .env aca. Si seguis, lo voy a sobreescribir.
    set /p CONFIRMAR=Sobreescribir? [s/n]:
    if /i not "%CONFIRMAR%"=="s" (
        echo Cancelado por el usuario.
        pause
        exit /b 1
    )
)
echo.
echo Pegame la SUPABASE_SERVICE_KEY (la que arranca con eyJ... ).
echo La podes copiar del .env de Unicenter (server) o del Supabase Dashboard.
echo.
set /p SUPA_KEY=SUPABASE_SERVICE_KEY:
if "%SUPA_KEY%"=="" (
    echo ❌ No ingresaste la key. Cancelo.
    pause
    exit /b 1
)

(
    echo # ═══════════════════════════════════════════════════════════
    echo #  sync_ventas_local — OFICINA
    echo #  Generado por install_oficina.bat
    echo # ═══════════════════════════════════════════════════════════
    echo VENTAS_LOCAL=oficina
    echo VENTAS_SQL_SERVER=localhost\ZOOLOGIC2026
    echo SUPABASE_URL=https://kwwiykssrpabncpqtmwi.supabase.co
    echo SUPABASE_SERVICE_KEY=%SUPA_KEY%
    echo POLL_SECONDS=60
) > .env
echo OK - .env creado.

:: ── 5) Instalar tarea programada ───────────────────────────
echo.
echo [5/5] Creando tarea programada...
call install_task.bat
if %errorlevel% neq 0 (
    echo ❌ Error creando la tarea. Probaste como Administrador?
    pause
    exit /b 1
)

echo.
echo ══════════════════════════════════════════════════════════
echo   ✓ INSTALACION COMPLETADA - OFICINA
echo ══════════════════════════════════════════════════════════
echo.
echo Para arrancar el sync AHORA sin esperar al proximo reinicio:
echo    schtasks /Run /TN "Ventas_Adorno_SyncLocal"
echo.
echo Para ver el log mientras corre:
echo    type sync.log
echo.
echo Para probar manualmente (sin tarea):
echo    python sync_ventas_local.py
echo.
pause
