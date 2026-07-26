# =====================================================================
#  update.ps1 -- Auto-deploy sync_ventas_local.py
#
#  Baja la ultima version del script desde el VPS Adorno (endpoint HTTPS
#  con Basic Auth) y la copia a C:\CRM_Adorno\ventas-adorno\sync_local\
#  si difiere del archivo local (comparacion por hash SHA256).
#
#  Corre ANTES del sync programado -- el Task Scheduler debe encadenar
#  este .ps1 y despues sync_ventas_local.py.
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File update.ps1
#
#  Si el VPS no responde, el script termina con exit 0 y NO toca el
#  archivo local (el sync sigue corriendo con la version anterior).
#  Los errores quedan en update.log.
# =====================================================================

$ErrorActionPreference = 'Continue'

# --- CONFIG ----------------------------------------------------------
$Deploy_Url    = 'https://142.93.248.133/sync-deploy/sync_ventas_local.py'
$Deploy_User   = 'adorno-sync'
$Deploy_TokenFile = "$PSScriptRoot\.deploy_token"
if ($env:UPDATE_TOKEN) {
    $Deploy_Password = $env:UPDATE_TOKEN
} elseif (Test-Path $Deploy_TokenFile) {
    $Deploy_Password = (Get-Content $Deploy_TokenFile -Raw).Trim()
} else {
    Write-Host "[update] ERROR: no encuentro el token de deploy (ni env UPDATE_TOKEN ni $Deploy_TokenFile)"
    exit 1
}

$LocalFile = "$PSScriptRoot\sync_ventas_local.py"
$BackupDir = "$PSScriptRoot\_backup"
$LogFile   = "$PSScriptRoot\update.log"
$TempFile  = "$env:TEMP\sync_ventas_local.py.new"

# --- LOG HELPER ------------------------------------------------------
function Log-Msg([string]$msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

Log-Msg "=== update.ps1 iniciado ==="

# --- 1) Bajar el .py del VPS -----------------------------------------
# Usamos curl.exe (viene por default en Windows 10+) en vez de
# Invoke-WebRequest porque este ultimo tiene problemas con certificados
# self-signed en PowerShell 5.1 aunque uno intente deshabilitar el check.
try {
    Remove-Item $TempFile -Force -ErrorAction SilentlyContinue
    $curlArgs = @(
        '-k',
        '-u', "$($Deploy_User):$($Deploy_Password)",
        '-o', $TempFile,
        '--silent',
        '--fail',
        '--max-time', '30',
        $Deploy_Url
    )
    & curl.exe @curlArgs 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "curl.exe exit code $LASTEXITCODE"
    }
    if (-not (Test-Path $TempFile) -or (Get-Item $TempFile).Length -eq 0) {
        throw "el archivo bajado esta vacio"
    }
    $size = (Get-Item $TempFile).Length
    Log-Msg "Descargado OK ($size bytes) desde $Deploy_Url"
} catch {
    Log-Msg "ERROR bajando del VPS: $($_.Exception.Message). Se mantiene la version local."
    exit 0
}

# --- 2) Verificar que el archivo bajado tenga sentido ----------------
$firstLine = Get-Content $TempFile -TotalCount 1
if ($firstLine -notmatch '^#|^"""|^import|^from') {
    Log-Msg "ERROR: el archivo bajado no parece Python (primera linea: $firstLine). Se descarta."
    Remove-Item $TempFile -Force -ErrorAction SilentlyContinue
    exit 0
}

# --- 3) Comparar hash con la version local ---------------------------
if (Test-Path $LocalFile) {
    $hashRemote = (Get-FileHash $TempFile -Algorithm SHA256).Hash
    $hashLocal  = (Get-FileHash $LocalFile -Algorithm SHA256).Hash
    if ($hashRemote -eq $hashLocal) {
        Log-Msg "Sin cambios (mismo SHA256). Nada que hacer."
        Remove-Item $TempFile -Force -ErrorAction SilentlyContinue
        exit 0
    }
    $shortLocal  = $hashLocal.Substring(0,12)
    $shortRemote = $hashRemote.Substring(0,12)
    Log-Msg "Cambio detectado: local=$shortLocal... remoto=$shortRemote..."
}

# --- 4) Backup del archivo actual ------------------------------------
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}
if (Test-Path $LocalFile) {
    $stamp  = Get-Date -Format 'yyyyMMdd_HHmmss'
    $backup = "$BackupDir\sync_ventas_local_$stamp.py"
    Copy-Item $LocalFile $backup -Force
    Log-Msg "Backup guardado en $backup"

    # Rotar backups: dejar solo los ultimos 10
    Get-ChildItem $BackupDir -Filter 'sync_ventas_local_*.py' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | Remove-Item -Force -ErrorAction SilentlyContinue
}

# --- 5) Reemplazar el archivo local ----------------------------------
try {
    Move-Item $TempFile $LocalFile -Force
    Log-Msg "OK sync_ventas_local.py actualizado exitosamente."
} catch {
    Log-Msg "ERROR reemplazando el archivo: $($_.Exception.Message)"
    exit 1
}

Log-Msg "=== update.ps1 terminado OK ==="
exit 0
