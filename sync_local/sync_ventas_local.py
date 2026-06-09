"""
sync_ventas_local.py
======================
Servicio que corre en la SERVER de Dragonfish de cada local.

Cómo funciona:
  1. Loop infinito: cada 60 segundos consulta dragonfish_jobs en Supabase
     buscando jobs con local=<MI_LOCAL> y estado='pendiente'.
  2. Por cada job: ejecuta la query SQL contra Dragonfish local (sumando
     las 2 bases del local — server física + terminal), arma los totales
     por medio de pago, y empuja a ventas_diarias en Supabase.
  3. Marca el job como 'completado' o 'error'.

Instalación:
  - Copiá esta carpeta a la SERVER de cada local
  - pip install pyodbc requests python-dotenv
  - Crear .env con las variables (ver .env.example)
  - Ejecutar manualmente: python sync_ventas_local.py
  - Para que corra 24/7: install.bat lo agrega a Task Scheduler
"""

import os
import sys
import time
import json
import logging
import socket
import traceback
from datetime import datetime, date

import pyodbc
import requests

# ══════════════════════════════════════════════════════════════════
#  CONFIG (todo desde .env)
# ══════════════════════════════════════════════════════════════════

def _load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(env_path):
        with open(env_path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
_load_env()

LOCAL          = os.environ.get('VENTAS_LOCAL', '').strip().lower()
SQL_SERVER     = os.environ.get('VENTAS_SQL_SERVER', '').strip() or r'localhost\ZOOLOGIC2026'
SUPABASE_URL   = os.environ.get('SUPABASE_URL', 'https://kwwiykssrpabncpqtmwi.supabase.co').rstrip('/')
SUPABASE_KEY   = os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
POLL_SECONDS   = int(os.environ.get('POLL_SECONDS', '60'))
LOG_FILE       = os.environ.get('LOG_FILE', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync.log'))

# Mapeo local → bases Dragonfish
# Por convenio del cliente: la primera DB es la SERVER (caja física, Shopping)
#                           la segunda es la TERMINAL/online (cuando aplique)
DBS = {
    'alcorta':   ('DRAGONFISH_ALCO1', 'DRAGONFISH_ALCO2'),
    'unicenter': ('DRAGONFISH_UNI1',  'DRAGONFISH_UNI2'),
    'oficina':   ('DRAGONFISH_ADMIN', None),
}

# ══════════════════════════════════════════════════════════════════
#  LOGGING
# ══════════════════════════════════════════════════════════════════

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger('sync_ventas')

# ══════════════════════════════════════════════════════════════════
#  Validación inicial
# ══════════════════════════════════════════════════════════════════

if LOCAL not in DBS:
    log.error(f"VENTAS_LOCAL inválido: {LOCAL!r}. Esperado: alcorta | unicenter | oficina")
    sys.exit(1)

if not SUPABASE_KEY:
    log.error("Falta SUPABASE_SERVICE_KEY en el .env (Settings → API → service_role)")
    sys.exit(1)

DB_FISICA, DB_ONLINE = DBS[LOCAL]
log.info(f"=== sync_ventas_local iniciado ===")
log.info(f"Hostname: {socket.gethostname()}")
log.info(f"Local: {LOCAL}")
log.info(f"SQL Server: {SQL_SERVER}")
log.info(f"DB física (Shopping): {DB_FISICA}")
log.info(f"DB online: {DB_ONLINE or 'no aplica'}")
log.info(f"Polling: cada {POLL_SECONDS}s")

# ══════════════════════════════════════════════════════════════════
#  Helpers SQL Server
# ══════════════════════════════════════════════════════════════════

def get_conn():
    """Conexión a SQL Server local con Windows auth."""
    return pyodbc.connect(
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={SQL_SERVER};"
        f"Trusted_Connection=yes;",
        timeout=15
    )

def consultar_dragonfish(fecha):
    """
    Consulta el Dragonfish local para una fecha y arma el dict listo para
    insertar en ventas_diarias.

    Estrategia (validada con datos reales):
      - DB física: COMPCAJADET (arqueo) → desglose por CODVAL
            efectivo = SUM(CODVAL='0')
            tarjeta  = SUM(CODVAL='TJ')
            qr       = SUM(CODVAL IN ('QR','QR2'))   # MP integrado + no integrado
            vales    = SUM(CODVAL='VC')              # Vale de Cambio (suele ser negativo)
        Cantidad transacciones = COUNT(COMPROBANTEV) en DB física
      - DB online (si existe): SUM(FTOTAL) de COMPROBANTEV → 'online'
    """
    fecha_str = fecha.strftime('%Y-%m-%d') if isinstance(fecha, (datetime, date)) else str(fecha)[:10]
    out = dict(
        local=LOCAL, fecha=fecha_str,
        efectivo=0, tarjeta=0, qr=0, vales=0,
        cant_transacciones=0,
        online=0, fc_oficina=0,
    )

    conn = get_conn()
    try:
        cur = conn.cursor()

        # ── DB física (Shopping) ────────────────────────────────────
        cur.execute(f"""
            SELECT
              SUM(CASE WHEN CODVAL='0'           THEN MONTO ELSE 0 END) AS efectivo,
              SUM(CASE WHEN CODVAL='TJ'          THEN MONTO ELSE 0 END) AS tarjeta,
              SUM(CASE WHEN CODVAL IN ('QR','QR2') THEN MONTO ELSE 0 END) AS qr,
              SUM(CASE WHEN CODVAL='VC'          THEN MONTO ELSE 0 END) AS vales
            FROM [{DB_FISICA}].ZooLogic.COMPCAJADET
            WHERE JJFECHA = ?
        """, fecha_str)
        row = cur.fetchone()
        if row:
            out['efectivo'] = float(row[0] or 0)
            out['tarjeta']  = float(row[1] or 0)
            out['qr']       = float(row[2] or 0)
            out['vales']    = float(row[3] or 0)

        # Cantidad de transacciones (solo DB física)
        cur.execute(f"""
            SELECT COUNT(*) FROM [{DB_FISICA}].ZooLogic.COMPROBANTEV
            WHERE FFCH = ? AND ANULADO = 0
        """, fecha_str)
        row = cur.fetchone()
        out['cant_transacciones'] = int(row[0] or 0) if row else 0

        # ── DB online (suma FTOTAL → 'online') ──────────────────────
        if DB_ONLINE:
            cur.execute(f"""
                SELECT COALESCE(SUM(FTOTAL), 0) FROM [{DB_ONLINE}].ZooLogic.COMPROBANTEV
                WHERE FFCH = ? AND ANULADO = 0
            """, fecha_str)
            row = cur.fetchone()
            out['online'] = float(row[0] or 0) if row else 0

        # ── Caso especial OFICINA: aún no separamos por medio de pago ─
        if LOCAL == 'oficina':
            # En oficina, las ventas son todas transferencia/MP. Sumamos todo el FTOTAL al campo 'online'
            cur.execute(f"""
                SELECT COALESCE(SUM(FTOTAL), 0) FROM [{DB_FISICA}].ZooLogic.COMPROBANTEV
                WHERE FFCH = ? AND ANULADO = 0
            """, fecha_str)
            row = cur.fetchone()
            out['online'] = float(row[0] or 0) if row else 0
            # Limpiamos los desgloses porque oficina no los usa
            out['efectivo'] = out['tarjeta'] = out['qr'] = out['vales'] = 0
    finally:
        conn.close()
    return out

# ══════════════════════════════════════════════════════════════════
#  Helpers Supabase
# ══════════════════════════════════════════════════════════════════

HDRS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
}

def supa_get_jobs_pendientes():
    """Trae los jobs pendientes para MI local."""
    url = (f"{SUPABASE_URL}/rest/v1/dragonfish_jobs"
           f"?local=eq.{LOCAL}&estado=eq.pendiente&order=solicitado_at.asc&limit=20")
    r = requests.get(url, headers=HDRS, timeout=15)
    r.raise_for_status()
    return r.json()

def supa_marcar_job(job_id, estado, error=None, payload=None):
    """Actualiza el estado del job."""
    body = {'estado': estado, 'completado_at': datetime.utcnow().isoformat() + 'Z'}
    if error: body['error_msg'] = str(error)[:1000]
    if payload: body['payload'] = payload
    url = f"{SUPABASE_URL}/rest/v1/dragonfish_jobs?id=eq.{job_id}"
    r = requests.patch(url, headers={**HDRS, 'Prefer': 'return=minimal'},
                       json=body, timeout=15)
    r.raise_for_status()

def supa_upsert_venta_diaria(data):
    """Inserta/actualiza la fila en ventas_diarias."""
    body = {**data,
            'origen': 'dragonfish_auto',
            'cargado_por': f'sync_local@{socket.gethostname()}',
            'cargado_at': datetime.utcnow().isoformat() + 'Z'}
    url = f"{SUPABASE_URL}/rest/v1/ventas_diarias?on_conflict=local,fecha"
    r = requests.post(url, headers={**HDRS,
                                     'Prefer': 'resolution=merge-duplicates,return=minimal'},
                      json=body, timeout=15)
    r.raise_for_status()

# ══════════════════════════════════════════════════════════════════
#  Loop principal
# ══════════════════════════════════════════════════════════════════

def procesar_job(job):
    job_id = job['id']
    fecha = job['fecha']
    log.info(f"[job#{job_id}] Procesando {LOCAL} {fecha}…")
    try:
        # marcar como 'en_proceso' para evitar que otro worker lo tome
        supa_marcar_job(job_id, 'en_proceso')

        data = consultar_dragonfish(fecha)
        log.info(f"[job#{job_id}] Resultado: ef={data['efectivo']} tj={data['tarjeta']} "
                 f"qr={data['qr']} vl={data['vales']} on={data['online']} cant={data['cant_transacciones']}")

        supa_upsert_venta_diaria(data)
        supa_marcar_job(job_id, 'completado', payload=data)
        log.info(f"[job#{job_id}] ✓ Completado")
    except Exception as e:
        err = traceback.format_exc()
        log.error(f"[job#{job_id}] ✗ ERROR: {err}")
        try:
            supa_marcar_job(job_id, 'error', error=str(e))
        except Exception:
            log.error("También falló al marcar el job como error.")

def loop():
    log.info("Entrando al loop principal...")
    while True:
        try:
            jobs = supa_get_jobs_pendientes()
            if jobs:
                log.info(f"{len(jobs)} job(s) pendientes para procesar")
                for j in jobs:
                    procesar_job(j)
            else:
                log.debug("Sin jobs pendientes.")
        except Exception as e:
            log.error(f"Error en loop: {e}")
        time.sleep(POLL_SECONDS)

# ══════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    # Modo CLI: si se pasa una fecha como argumento, hace solo esa
    # python sync_ventas_local.py 2026-06-05
    if len(sys.argv) > 1:
        fecha_arg = sys.argv[1]
        log.info(f"Modo manual: consultando {LOCAL} {fecha_arg}")
        data = consultar_dragonfish(fecha_arg)
        log.info(f"Resultado: {json.dumps(data, indent=2, default=str)}")
        if '--push' in sys.argv:
            supa_upsert_venta_diaria(data)
            log.info("✓ Subido a Supabase")
        sys.exit(0)
    # Modo servicio (loop)
    loop()
