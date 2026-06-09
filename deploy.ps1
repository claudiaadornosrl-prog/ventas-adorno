# ════════════════════════════════════════════════════════
#  Deploy ventas-adorno — push a GitHub Pages
# ════════════════════════════════════════════════════════
param([string]$msg = "")

cd "$PSScriptRoot"

# Limpiar lock de git si quedó de un crash previo
Remove-Item -Path ".git\index.lock" -ErrorAction SilentlyContinue

git config user.email "claudiaadornosrl@gmail.com"
git config user.name  "Claudia Adorno"

# Agregar TODO lo modificado/nuevo (mejor que hardcodear archivos como hace el CRM viejo)
git add -A

# Mensaje
if (-not $msg) { $msg = "update" }

# Solo commitear si hay cambios
$changes = git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "$msg"
    git push
} else {
    Write-Host "Sin cambios para commitear"
}

Write-Host ""
Write-Host "Listo. Presiona cualquier tecla para cerrar."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
