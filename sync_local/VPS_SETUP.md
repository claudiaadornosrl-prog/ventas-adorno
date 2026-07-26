# VPS Setup — endpoint HTTPS para servir sync_ventas_local.py

Este documento explica cómo configurar el VPS DigitalOcean (`142.93.248.133`) para
servir el archivo `sync_ventas_local.py` a las 3 servidoras (Alcorta, Unicenter,
Oficina) con autenticación Basic Auth.

## Arquitectura

```
                     ┌─────────────────────────────────────────┐
                     │  VPS Adorno (DigitalOcean)              │
                     │  142.93.248.133                          │
                     │                                          │
                     │  nginx (puerto 443)                      │
                     │    /sync-deploy/  ← Basic Auth           │
                     │       ↓                                  │
                     │  /opt/adorno/sync_deploy/                │
                     │    sync_ventas_local.py                  │
                     └────────────┬─────────────────────────────┘
                                  │  HTTPS + Basic Auth
                     ┌────────────┼────────────┬────────────────┐
                     ↓            ↓            ↓
              [ALCORTA-PC]  [UNICENTER-PC]  [OFICINA-PC]
              update.ps1    update.ps1      update.ps1
                     ↓            ↓            ↓
              sync_ventas_local.py  (idéntico en las 3)
```

## Paso 1 — En el VPS (una sola vez)

Ejecutar via el command queue de Supabase o SSH:

```bash
# 1) Crear carpeta de deploy
sudo mkdir -p /opt/adorno/sync_deploy
sudo chown $USER:$USER /opt/adorno/sync_deploy

# 2) Copiar la versión inicial del sync
# (haces scp desde tu PC, o via el command queue)
scp C:\CRM_Adorno\ventas-adorno\sync_local\sync_ventas_local.py \
    root@142.93.248.133:/opt/adorno/sync_deploy/

# 3) Instalar nginx si no está
sudo apt-get update && sudo apt-get install -y nginx apache2-utils

# 4) Crear el archivo de passwords (htpasswd)
# El usuario será "adorno-sync" y la password la generas con:
sudo htpasswd -c /etc/nginx/.htpasswd_sync adorno-sync
# → te pregunta la password 2 veces. Guardala también en tu PC para poner
#   en el archivo .deploy_token de cada servidora.

# 5) Configurar el vhost de nginx
sudo tee /etc/nginx/sites-available/sync-deploy > /dev/null <<'EOF'
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    # Cert self-signed (el update.ps1 lo acepta)
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    location /sync-deploy/ {
        auth_basic "Adorno Deploy";
        auth_basic_user_file /etc/nginx/.htpasswd_sync;

        alias /opt/adorno/sync_deploy/;
        autoindex off;
        types { text/plain py; }
        default_type text/plain;
    }

    # Bloquear todo lo demás
    location / { return 404; }
}
EOF

sudo ln -sf /etc/nginx/sites-available/sync-deploy /etc/nginx/sites-enabled/sync-deploy
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 6) Abrir el puerto 443 en el firewall (si UFW está activo)
sudo ufw allow 443/tcp

# 7) Testear desde tu PC (deberías ver el contenido del .py)
curl -k -u adorno-sync:TU_PASSWORD https://142.93.248.133/sync-deploy/sync_ventas_local.py | head -20
```

## Paso 2 — En cada servidora (Alcorta, Unicenter, Oficina)

```powershell
# 1) Crear el archivo con el token (password de nginx htpasswd)
# NO lo pongas en el .py, va aparte para que quede fuera de git.
$token = 'la_password_que_pusiste_en_htpasswd_sync'
$token | Out-File -Encoding ASCII "C:\CRM_Adorno\ventas-adorno\sync_local\.deploy_token"

# 2) Testear que update.ps1 funciona
cd C:\CRM_Adorno\ventas-adorno\sync_local
powershell -ExecutionPolicy Bypass -File update.ps1

# Deberías ver en update.log algo como:
#   Descargado OK (48123 bytes) desde https://142.93.248.133/sync-deploy/...
#   Sin cambios (mismo SHA256 = abc123...)
```

## Paso 3 — Task Scheduler (en cada servidora)

Modificar la task existente que corre `sync_ventas_local.py` para que ANTES
corra `update.ps1`:

```powershell
# Editar la task: en "Actions" agregar como primer paso:
#   Program:   powershell.exe
#   Arguments: -ExecutionPolicy Bypass -File C:\CRM_Adorno\ventas-adorno\sync_local\update.ps1

# Y como segundo paso, el sync habitual:
#   Program:   python.exe
#   Arguments: C:\CRM_Adorno\ventas-adorno\sync_local\sync_ventas_local.py
```

O crear una task nueva `SyncVentas_UpdateAntes` que corra 5 minutos antes de la
del sync. Ambas opciones funcionan.

## Cómo hacer un deploy (después del setup)

Cuando modifiques `sync_ventas_local.py` en tu PC y quieras deployarlo:

```powershell
# Desde tu PC (una sola vez, después de guardar el archivo):
scp C:\CRM_Adorno\ventas-adorno\sync_local\sync_ventas_local.py `
    root@142.93.248.133:/opt/adorno/sync_deploy/

# O usando el command queue de Supabase (vps_commands table), 
# subís el archivo via cat + here-doc o via git pull en el VPS.
```

Las 3 servidoras van a bajar la nueva versión en el próximo ciclo del Task Scheduler.

## Rollback

Si algo se rompe con la nueva versión:

1. **Rollback masivo desde el VPS**: subís al VPS la versión anterior (por scp
   o restaurando desde `/opt/adorno/sync_deploy/_backup/`). Las 3 servidoras
   bajan la vieja en el próximo tick.

2. **Rollback en una servidora puntual**: en la servidora afectada, restaurar
   desde `C:\CRM_Adorno\ventas-adorno\sync_local\_backup\sync_ventas_local_<stamp>.py`
   y desactivar update.ps1 hasta que arregles el VPS.

## Logs

- **En cada servidora**: `C:\CRM_Adorno\ventas-adorno\sync_local\update.log`
- **En el VPS** (accesos y errores): `/var/log/nginx/access.log` y `error.log`
