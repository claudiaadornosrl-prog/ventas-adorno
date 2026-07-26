#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  vps_setup.sh — Setup del endpoint HTTPS para servir sync_ventas_local.py
#
#  Se corre UNA sola vez en el VPS, via SSH:
#      ssh root@142.93.248.133
#      bash vps_setup.sh
#
#  Antes de correr:
#    - Copiar sync_ventas_local.py al VPS (via scp)
#    - Decidir la password para adorno-sync (te la va a pedir el script)
# ═══════════════════════════════════════════════════════════════════════

set -e  # abortar en el primer error

echo "=== VPS setup — endpoint HTTPS para deploy del sync ==="

# ── 1) Crear carpeta ──────────────────────────────────────────────
sudo mkdir -p /opt/adorno/sync_deploy
sudo chown -R $USER:$USER /opt/adorno/sync_deploy
echo "✓ Carpeta /opt/adorno/sync_deploy creada"

# ── 2) Instalar nginx + htpasswd ──────────────────────────────────
sudo apt-get update -qq
sudo apt-get install -y nginx apache2-utils
echo "✓ nginx + htpasswd instalados"

# ── 3) Crear archivo de passwords ─────────────────────────────────
# Va a pedir la password 2 veces. Anotala — la vas a poner en el
# .deploy_token de cada servidora.
echo ""
echo "⚠️  Ahora vas a definir la password para el usuario 'adorno-sync'."
echo "    Anotala en un lugar seguro."
echo ""
sudo htpasswd -c /etc/nginx/.htpasswd_sync adorno-sync
echo "✓ .htpasswd_sync creado"

# ── 4) Configurar vhost nginx ─────────────────────────────────────
sudo tee /etc/nginx/sites-available/sync-deploy > /dev/null <<'NGINX'
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    ssl_certificate     /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    location /sync-deploy/ {
        auth_basic           "Adorno Deploy";
        auth_basic_user_file /etc/nginx/.htpasswd_sync;

        alias /opt/adorno/sync_deploy/;
        autoindex off;
        default_type text/plain;
    }

    location / { return 404; }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/sync-deploy /etc/nginx/sites-enabled/sync-deploy
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "✓ nginx configurado y recargado"

# ── 5) Firewall ───────────────────────────────────────────────────
if command -v ufw &> /dev/null; then
    sudo ufw allow 443/tcp || true
    echo "✓ Puerto 443 abierto en UFW"
fi

# ── 6) Verificar contenido del deploy ─────────────────────────────
if [ ! -f /opt/adorno/sync_deploy/sync_ventas_local.py ]; then
    echo ""
    echo "⚠️  Todavía no subiste sync_ventas_local.py al VPS."
    echo "    Desde tu PC (Windows PowerShell), ejecutá:"
    echo ""
    echo "    scp C:\\CRM_Adorno\\ventas-adorno\\sync_local\\sync_ventas_local.py \\"
    echo "        root@142.93.248.133:/opt/adorno/sync_deploy/"
else
    echo ""
    echo "✓ sync_ventas_local.py ya está en el VPS"
    echo "  Tamaño: $(stat -c%s /opt/adorno/sync_deploy/sync_ventas_local.py) bytes"
fi

echo ""
echo "=== Setup completo ==="
echo ""
echo "Próximos pasos (en tu PC):"
echo "  1. Subir el .py (si todavía no lo hiciste):"
echo "     scp C:\\CRM_Adorno\\ventas-adorno\\sync_local\\sync_ventas_local.py root@142.93.248.133:/opt/adorno/sync_deploy/"
echo ""
echo "  2. En cada servidora (Alcorta, Unicenter, Oficina):"
echo "     - Guardar la password en C:\\CRM_Adorno\\ventas-adorno\\sync_local\\.deploy_token"
echo "     - Testear: powershell -File update.ps1"
echo "     - Configurar Task Scheduler para correr update.ps1 antes del sync"
echo ""
echo "Test rápido desde tu PC:"
echo "  curl -k -u adorno-sync:LA_PASSWORD https://142.93.248.133/sync-deploy/sync_ventas_local.py | head -20"
