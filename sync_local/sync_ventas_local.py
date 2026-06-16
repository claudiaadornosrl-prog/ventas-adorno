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
from datetime import datetime, date, timedelta

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
POLL_SECONDS   = int(os.environ.get('POLL_SECONDS', '10'))
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

def _elegir_driver():
    """Auto-detecta el mejor driver ODBC disponible (probamos en orden de preferencia)."""
    disponibles = [d.strip() for d in pyodbc.drivers()]
    preferencia = [
        'ODBC Driver 18 for SQL Server',
        'ODBC Driver 17 for SQL Server',
        'ODBC Driver 13 for SQL Server',
        'ODBC Driver 11 for SQL Server',
        'SQL Server Native Client 11.0',
        'SQL Server Native Client 10.0',
        'SQL Server',
    ]
    for d in preferencia:
        if d in disponibles:
            return d
    if disponibles:
        return disponibles[0]
    raise RuntimeError('No hay drivers ODBC para SQL Server instalados')

_DRIVER = None
def get_conn():
    """Conexión a SQL Server local con Windows auth."""
    global _DRIVER
    if _DRIVER is None:
        _DRIVER = _elegir_driver()
        log.info(f"Driver ODBC elegido: {_DRIVER}")
    return pyodbc.connect(
        f"DRIVER={{{_DRIVER}}};"
        f"SERVER={SQL_SERVER};"
        f"Trusted_Connection=yes;"
        f"TrustServerCertificate=yes;",   # ODBC 18 lo necesita para conexiones sin cert SSL
        timeout=15
    )

def consultar_dragonfish_rango(desde, hasta):
    """
    Consulta TODO un rango de fechas en 3 queries (en lugar de N por día).
    Devuelve dict {'YYYY-MM-DD': {efectivo, tarjeta, qr, vales, online, fc_oficina, cant_transacciones}}.

    Diseño: 1 query a VAL con BETWEEN+GROUP BY, 1 query a COMPROBANTEV física,
    1 query a COMPROBANTEV online. Mucho más rápido que iterar 30 días sueltos.
    """
    desde_str = desde.strftime('%Y-%m-%d') if isinstance(desde, (datetime, date)) else str(desde)[:10]
    hasta_str = hasta.strftime('%Y-%m-%d') if isinstance(hasta, (datetime, date)) else str(hasta)[:10]

    # Inicializar diccionario con todas las fechas del rango en 0
    out = {}
    d_ini = datetime.strptime(desde_str, '%Y-%m-%d').date()
    d_fin = datetime.strptime(hasta_str, '%Y-%m-%d').date()
    d = d_ini
    while d <= d_fin:
        f = d.strftime('%Y-%m-%d')
        out[f] = dict(
            local=LOCAL, fecha=f,
            efectivo=0, efectivo_negro=0, tarjeta=0, qr=0, vales=0,
            transferencia=0, cc=0,
            cant_transacciones=0,
            online=0, fc_oficina=0,
        )
        d += timedelta(days=1)

    conn = get_conn()
    try:
        cur = conn.cursor()

        # ── VAL: desglose por medio de pago, agrupado por fecha ──────
        # ── VAL: agrupamos por fecha SIN HORA (CAST AS date) para no romper
        # cuando JJFECHA es DATETIME y tiene múltiples timestamps en el mismo día.
        cur.execute(f"""
            SELECT CONVERT(varchar(10), CAST(JJFECHA AS date), 23) AS f,
              SUM(CASE WHEN JJCO LIKE '0%'  THEN MONTOSISTE ELSE 0 END) AS efectivo,
              SUM(CASE WHEN JJCO LIKE 'TJ%' THEN MONTOSISTE ELSE 0 END) AS tarjeta,
              SUM(CASE WHEN JJCO LIKE 'QR%' THEN MONTOSISTE ELSE 0 END) AS qr,
              SUM(CASE WHEN JJCO LIKE 'VC%' THEN MONTOSISTE ELSE 0 END) AS vales
            FROM [{DB_FISICA}].ZooLogic.VAL
            WHERE CAST(JJFECHA AS date) BETWEEN ? AND ?
              AND (ESVUELTO = 0 OR ESVUELTO IS NULL)
            GROUP BY CAST(JJFECHA AS date)
        """, desde_str, hasta_str)
        for row in cur.fetchall():
            f = str(row[0])[:10]
            if f in out:
                # += en vez de = como defensa extra por si hubiera duplicados
                out[f]['efectivo'] += float(row[1] or 0)
                out[f]['tarjeta']  += float(row[2] or 0)
                out[f]['qr']       += float(row[3] or 0)
                out[f]['vales']    += float(row[4] or 0)

        # ── COMPROBANTEV física: cantidad de transacciones por fecha ─
        cur.execute(f"""
            SELECT CONVERT(varchar(10), CAST(FFCH AS date), 23) AS f, COUNT(*)
            FROM [{DB_FISICA}].ZooLogic.COMPROBANTEV
            WHERE CAST(FFCH AS date) BETWEEN ? AND ? AND ANULADO = 0
            GROUP BY CAST(FFCH AS date)
        """, desde_str, hasta_str)
        for row in cur.fetchall():
            f = str(row[0])[:10]
            if f in out:
                out[f]['cant_transacciones'] += int(row[1] or 0)

        # ── COMPROBANTEV online (si existe): total online por fecha ──
        if DB_ONLINE:
            cur.execute(f"""
                SELECT CONVERT(varchar(10), CAST(FFCH AS date), 23) AS f, COALESCE(SUM(FTOTAL), 0)
                FROM [{DB_ONLINE}].ZooLogic.COMPROBANTEV
                WHERE CAST(FFCH AS date) BETWEEN ? AND ? AND ANULADO = 0
                GROUP BY CAST(FFCH AS date)
            """, desde_str, hasta_str)
            for row in cur.fetchall():
                f = str(row[0])[:10]
                if f in out:
                    out[f]['online'] += float(row[1] or 0)

            # ── Efectivo de bases 2 (NEGRO): VAL con JJCO LIKE '0%' ──
            # JP confirmó que UNI2/ALCO2 también usan código 0 para efectivo.
            cur.execute(f"""
                SELECT CONVERT(varchar(10), CAST(JJFECHA AS date), 23) AS f,
                  SUM(CASE WHEN JJCO LIKE '0%' THEN MONTOSISTE ELSE 0 END) AS efectivo_negro
                FROM [{DB_ONLINE}].ZooLogic.VAL
                WHERE CAST(JJFECHA AS date) BETWEEN ? AND ?
                  AND (ESVUELTO = 0 OR ESVUELTO IS NULL)
                GROUP BY CAST(JJFECHA AS date)
            """, desde_str, hasta_str)
            for row in cur.fetchall():
                f = str(row[0])[:10]
                if f in out:
                    out[f]['efectivo_negro'] += float(row[1] or 0)

        # OJO: para Oficina NO usamos esta función. La lógica de Oficina
        # vive en consultar_oficina_facturas_rango() porque necesita filtrar
        # solo facturas electrónicas (A/B/C) y desglosar por vendedor + JJCO.
    finally:
        conn.close()
    return out


# ══════════════════════════════════════════════════════════════════
#  Oficina: facturas electrónicas con bucket por vendedor + método pago
# ══════════════════════════════════════════════════════════════════
def consultar_oficina_facturas_rango(desde, hasta):
    """Lee facturas/NC electrónicas (FLETRA A/B/C, FACTTIPO 27/28) de Oficina
    y las distribuye en 3 buckets de ventas_diarias según el vendedor (FVEN):

      - FVEN=OFICINA   → ventas_diarias(local=oficina) con desglose por JJCO
                         (efectivo / transferencia / qr / cc / tarjeta / online)
      - FVEN=ALCORTA   → ventas_diarias(local=alcorta).fc_oficina
      - FVEN=UNICENTER → ventas_diarias(local=unicenter).fc_oficina

    NO incluye remitos. El JOIN COMPROBANTEV.CODIGO = VAL.JJNUM trae el
    método de pago real de cada factura.

    Returns: list[dict] listo para bulk upsert a ventas_diarias.
    """
    desde_str = desde.strftime('%Y-%m-%d') if isinstance(desde, (datetime, date)) else str(desde)[:10]
    hasta_str = hasta.strftime('%Y-%m-%d') if isinstance(hasta, (datetime, date)) else str(hasta)[:10]

    # Mapeo vendedor → local
    VENDEDOR_A_LOCAL = {
        'OFICINA':   'oficina',
        'ALCORTA':   'alcorta',
        'UNICENTER': 'unicenter',
    }

    # Mapeo JJCO → columna de ventas_diarias (solo aplica a FVEN=OFICINA)
    def jjco_a_columna(jjco: str) -> str:
        j = (jjco or '').upper().strip()
        if j.startswith('0'):     return 'efectivo'
        if j.startswith('TRANS'): return 'transferencia'
        if j.startswith('QR'):    return 'qr'
        if j == 'C':              return 'cc'
        if j.startswith('TJ'):    return 'tarjeta'
        return 'online'  # cualquier otro código (incluyendo 'CC' largo, 'VC', etc.)

    # Acumulador {(local, fecha) → fila}
    def fila_vacia(local: str, fecha: str) -> dict:
        return dict(
            local=local, fecha=fecha,
            efectivo=0, transferencia=0, qr=0, cc=0, tarjeta=0,
            vales=0, online=0, fc_oficina=0, cant_transacciones=0,
        )

    acum: dict = {}

    conn = get_conn()
    try:
        cur = conn.cursor()

        # ── 1) Importes por (fecha, FVEN, JJCO) ─────────────────────────
        # JOIN COMPROBANTEV ↔ VAL por VAL.JJNUM = COMPROBANTEV.CODIGO
        # Solo facturas A/B/C (excluye remitos)
        # NOTA: usamos c.SIGNOMOV (1 factura, -1 NC) en lugar de v.SIGNO
        # porque v.SIGNO viene en 0 en Dragonfish ADMIN y rompía el cálculo.
        cur.execute(f"""
            SELECT
                CONVERT(varchar(10), CAST(c.FFCH AS date), 23) AS fecha,
                RTRIM(c.FVEN) AS vendedor,
                RTRIM(v.JJCO) AS jjco,
                SUM(v.MONTOSISTE * c.SIGNOMOV) AS total
            FROM [{DB_FISICA}].ZooLogic.COMPROBANTEV c
            JOIN [{DB_FISICA}].ZooLogic.VAL v ON v.JJNUM = c.CODIGO
            WHERE CAST(c.FFCH AS date) BETWEEN ? AND ?
              AND c.ANULADO = 0
              AND c.FLETRA IN ('A','B','C')
              AND (v.ESVUELTO = 0 OR v.ESVUELTO IS NULL)
            GROUP BY CAST(c.FFCH AS date), RTRIM(c.FVEN), RTRIM(v.JJCO)
        """, desde_str, hasta_str)

        for row in cur.fetchall():
            fecha = str(row[0])[:10]
            vendedor = (row[1] or '').upper()
            jjco = row[2] or ''
            total = float(row[3] or 0)

            local = VENDEDOR_A_LOCAL.get(vendedor)
            if not local:
                log.warning(f"[oficina] vendedor desconocido en COMPROBANTEV: {vendedor!r} (se ignora)")
                continue

            key = (local, fecha)
            if key not in acum:
                acum[key] = fila_vacia(local, fecha)

            if local == 'oficina':
                # Distribuir según el código JJCO en su columna
                columna = jjco_a_columna(jjco)
                acum[key][columna] += total
            else:
                # alcorta / unicenter → todo a fc_oficina del local destino
                acum[key]['fc_oficina'] += total

        # ── 2) Cantidad de transacciones por (fecha, FVEN) ──────────────
        # Solo cuenta facturas A/B/C, no remitos. Una factura puede tener
        # varios pagos en VAL pero cuenta como 1 transacción.
        cur.execute(f"""
            SELECT
                CONVERT(varchar(10), CAST(FFCH AS date), 23) AS fecha,
                RTRIM(FVEN) AS vendedor,
                COUNT(*) AS cant
            FROM [{DB_FISICA}].ZooLogic.COMPROBANTEV
            WHERE CAST(FFCH AS date) BETWEEN ? AND ?
              AND ANULADO = 0
              AND FLETRA IN ('A','B','C')
            GROUP BY CAST(FFCH AS date), RTRIM(FVEN)
        """, desde_str, hasta_str)

        for row in cur.fetchall():
            fecha = str(row[0])[:10]
            vendedor = (row[1] or '').upper()
            cant = int(row[2] or 0)

            local = VENDEDOR_A_LOCAL.get(vendedor)
            if not local:
                continue

            key = (local, fecha)
            if key not in acum:
                acum[key] = fila_vacia(local, fecha)
            acum[key]['cant_transacciones'] += cant
    finally:
        conn.close()

    return list(acum.values())


def consultar_dragonfish(fecha):
    """
    Consulta el Dragonfish local para una fecha y arma el dict listo para
    insertar en ventas_diarias.

    Estrategia VALIDADA contra Excel del cliente (Unicenter 5/6 → exacto 5.595.100):
      - DB física → tabla VAL (cashflow en tiempo real, igual al Z del cierre):
            efectivo = SUM(MONTOSISTE) WHERE JJCO LIKE '0%'  (PESOS)
            tarjeta  = SUM(MONTOSISTE) WHERE JJCO LIKE 'TJ%' (Tarjetas + (Int.) Tarjetas)
            qr       = SUM(MONTOSISTE) WHERE JJCO LIKE 'QR%' (MP integrado + (Int.) MP + QR2)
            vales    = SUM(MONTOSISTE) WHERE JJCO LIKE 'VC%' (Vale de Cambio)
            ESVUELTO = 0 para no contar los vueltos
        Cantidad transacciones = COUNT(COMPROBANTEV) en DB física por FFCH (facturas del día)
      - DB online (si existe): SUM(FTOTAL) de COMPROBANTEV → 'online'
    """
    fecha_str = fecha.strftime('%Y-%m-%d') if isinstance(fecha, (datetime, date)) else str(fecha)[:10]
    out = dict(
        local=LOCAL, fecha=fecha_str,
        efectivo=0, tarjeta=0, qr=0, vales=0,
        transferencia=0, cc=0,
        cant_transacciones=0,
        online=0, fc_oficina=0,
    )

    conn = get_conn()
    try:
        cur = conn.cursor()

        # ── DB física: desglose por medio de pago desde VAL ─────────
        # VAL se actualiza en tiempo real con cada venta (no espera al cierre Z)
        cur.execute(f"""
            SELECT
              SUM(CASE WHEN JJCO LIKE '0%'  THEN MONTOSISTE ELSE 0 END) AS efectivo,
              SUM(CASE WHEN JJCO LIKE 'TJ%' THEN MONTOSISTE ELSE 0 END) AS tarjeta,
              SUM(CASE WHEN JJCO LIKE 'QR%' THEN MONTOSISTE ELSE 0 END) AS qr,
              SUM(CASE WHEN JJCO LIKE 'VC%' THEN MONTOSISTE ELSE 0 END) AS vales
            FROM [{DB_FISICA}].ZooLogic.VAL
            WHERE JJFECHA = ? AND (ESVUELTO = 0 OR ESVUELTO IS NULL)
        """, fecha_str)
        row = cur.fetchone()
        if row:
            out['efectivo'] = float(row[0] or 0)
            out['tarjeta']  = float(row[1] or 0)
            out['qr']       = float(row[2] or 0)
            out['vales']    = float(row[3] or 0)

        # Cantidad de transacciones (facturas no anuladas del día — FFCH en COMPROBANTEV)
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

def supa_bulk_upsert_ventas(rows):
    """Inserta/actualiza N filas en ventas_diarias con un solo POST."""
    if not rows:
        return
    meta = {'origen': 'dragonfish_auto',
            'cargado_por': f'sync_local@{socket.gethostname()}',
            'cargado_at': datetime.utcnow().isoformat() + 'Z'}
    body = [{**r, **meta} for r in rows]
    url = f"{SUPABASE_URL}/rest/v1/ventas_diarias?on_conflict=local,fecha"
    r = requests.post(url, headers={**HDRS,
                                     'Prefer': 'resolution=merge-duplicates,return=minimal'},
                      json=body, timeout=30)
    r.raise_for_status()


def consultar_transacciones_mp_rango(desde, hasta):
    """Trae cada transacción MP individual del rango (no agregada).

    Una fila de la tabla VAL de Dragonfish = una transacción de venta.
    Filtramos por JJCO LIKE 'QR%' (que en Dragonfish = MP, tanto QR como Point).

    Devuelve list de dicts con shape ventas_transacciones.
    """
    desde_str = desde.strftime('%Y-%m-%d') if isinstance(desde, (datetime, date)) else str(desde)[:10]
    hasta_str = hasta.strftime('%Y-%m-%d') if isinstance(hasta, (datetime, date)) else str(hasta)[:10]
    out = []
    conn = get_conn()
    try:
        cur = conn.cursor()
        # ── Base FISICA: MP "blanco" ─────────────────────────────────
        cur.execute(f"""
            SELECT JJFECHA, JJCO, MONTOSISTE
            FROM [{DB_FISICA}].ZooLogic.VAL
            WHERE CAST(JJFECHA AS date) BETWEEN ? AND ?
              AND (ESVUELTO = 0 OR ESVUELTO IS NULL)
              AND JJCO LIKE 'QR%'
              AND MONTOSISTE > 0
        """, desde_str, hasta_str)
        for jjfecha, jjco, monto in cur.fetchall():
            out.append(_armar_transaccion_mp(jjfecha, jjco, monto, base='fisica'))

        # ── Base ONLINE (negro): MP "negro" ───────────────────────────
        if DB_ONLINE:
            cur.execute(f"""
                SELECT JJFECHA, JJCO, MONTOSISTE
                FROM [{DB_ONLINE}].ZooLogic.VAL
                WHERE CAST(JJFECHA AS date) BETWEEN ? AND ?
                  AND (ESVUELTO = 0 OR ESVUELTO IS NULL)
                  AND JJCO LIKE 'QR%'
                  AND MONTOSISTE > 0
            """, desde_str, hasta_str)
            for jjfecha, jjco, monto in cur.fetchall():
                out.append(_armar_transaccion_mp(jjfecha, jjco, monto, base='online'))
    finally:
        conn.close()
    return out


def _armar_transaccion_mp(jjfecha, jjco, monto, base):
    """Convierte una fila de VAL a un dict para insertar en ventas_transacciones."""
    import hashlib
    # JJFECHA puede ser datetime o str. Normalizamos a ISO con TZ Argentina.
    if isinstance(jjfecha, datetime):
        # Le pegamos -03:00 (BAires) porque Dragonfish guarda hora local sin TZ.
        aprobado_at = jjfecha.strftime('%Y-%m-%dT%H:%M:%S') + '-03:00'
        fecha_only = jjfecha.strftime('%Y-%m-%d')
    else:
        s = str(jjfecha)
        aprobado_at = s + '-03:00' if 'T' in s and '+' not in s and '-03' not in s else s
        fecha_only = s[:10]

    # Hash externo: local + jjfecha + jjco + monto. Único razonable.
    raw = f"{LOCAL}|{aprobado_at}|{jjco}|{monto}|{base}"
    h = hashlib.md5(raw.encode('utf-8')).hexdigest()

    return {
        'local':        LOCAL,
        'fecha':        fecha_only,
        'aprobado_at':  aprobado_at,
        'importe':      float(monto or 0),
        'codigo_jjco':  str(jjco or ''),
        'tipo':         'mp',
        'base':         base,
        'hash_externo': h,
    }


def supa_bulk_upsert_transacciones(rows):
    """Inserta transacciones individuales en ventas_transacciones con dedup
    por (local, hash_externo). Las que ya están las ignora."""
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/ventas_transacciones?on_conflict=local,hash_externo"
    r = requests.post(url, headers={**HDRS,
                                     'Prefer': 'resolution=ignore-duplicates,return=minimal'},
                      json=rows, timeout=60)
    r.raise_for_status()
    return len(rows)

# ══════════════════════════════════════════════════════════════════
#  Loop principal
# ══════════════════════════════════════════════════════════════════

def procesar_job(job):
    """
    Procesa un job. Si tipo='mes', itera del fecha_desde al fecha_hasta inclusive.
    Si tipo='dia' (default), solo procesa job['fecha'].
    """
    job_id = job['id']
    tipo = (job.get('tipo') or 'dia').lower()
    log.info(f"[job#{job_id}] tipo={tipo}")
    try:
        supa_marcar_job(job_id, 'en_proceso')

        # Determinar rango de fechas a procesar
        if tipo == 'mes':
            d_ini_str = job['fecha_desde'][:10]
            d_fin_str = job['fecha_hasta'][:10]
        else:
            d_ini_str = d_fin_str = job['fecha'][:10] if job.get('fecha') else None
        if not d_ini_str:
            raise RuntimeError("Job sin fecha")

        d_ini = datetime.strptime(d_ini_str, '%Y-%m-%d').date()
        d_fin = datetime.strptime(d_fin_str, '%Y-%m-%d').date()
        ndias = (d_fin - d_ini).days + 1
        log.info(f"[job#{job_id}] rango {d_ini_str} → {d_fin_str} ({ndias} día(s))")

        # 1) Consultar TODO el rango con 1 sola query (BETWEEN + GROUP BY)
        # Para Oficina usamos una lógica especial que distribuye por vendedor:
        # las ventas FVEN=ALCORTA/UNICENTER se mandan a la planilla de su local.
        t0 = time.time()
        if LOCAL == 'oficina':
            rows_oficina = consultar_oficina_facturas_rango(d_ini, d_fin)
            log.info(f"[job#{job_id}] Dragonfish (oficina) OK en {time.time()-t0:.2f}s — "
                     f"{len(rows_oficina)} filas (oficina + alcorta + unicenter)")
            # Filtrar filas totalmente vacías
            rows = [r for r in rows_oficina if r['cant_transacciones'] > 0 or any([
                r['efectivo'], r['transferencia'], r['qr'], r['cc'], r['tarjeta'],
                r['vales'], r['online'], r['fc_oficina']
            ])]
        else:
            rango = consultar_dragonfish_rango(d_ini, d_fin)
            log.info(f"[job#{job_id}] Dragonfish OK en {time.time()-t0:.2f}s — {len(rango)} fechas")

            # Filtrar las que tienen al menos un dato (saltear días vacíos)
            rows = []
            for f, data in sorted(rango.items()):
                if data['cant_transacciones'] == 0 and not any([
                    data['efectivo'], data['tarjeta'], data['qr'],
                    data['vales'], data['online'], data['fc_oficina']
                ]):
                    continue
                rows.append(data)

        # 3) Bulk upsert a Supabase (1 sola request en lugar de N)
        if rows:
            t0 = time.time()
            supa_bulk_upsert_ventas(rows)
            log.info(f"[job#{job_id}] Supabase OK en {time.time()-t0:.2f}s — {len(rows)} fechas upserteadas")
        else:
            log.info(f"[job#{job_id}] sin datos en el rango, nada para upsertear")

        # 4) Subir TAMBIÉN cada transacción MP individual (para cruce fila por
        #    fila contra la cuenta MP al cerrar un turno).
        n_tx = 0
        try:
            t0 = time.time()
            txs = consultar_transacciones_mp_rango(d_ini, d_fin)
            if txs:
                n_tx = supa_bulk_upsert_transacciones(txs)
                log.info(f"[job#{job_id}] transacciones MP OK en {time.time()-t0:.2f}s — {n_tx} transacciones subidas")
            else:
                log.info(f"[job#{job_id}] sin transacciones MP en el rango")
        except Exception as etx:
            # No rompemos el job si esto falla — el agregado ya está OK.
            log.warning(f"[job#{job_id}] no pude sincronizar transacciones MP: {etx}")

        payload = {
            'dias_procesados': len(rows),
            'transacciones_mp': n_tx,
            'rango': f"{d_ini_str} a {d_fin_str}",
        }
        supa_marcar_job(job_id, 'completado', payload=payload)
        log.info(f"[job#{job_id}] ✓ {len(rows)} días procesados")
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
