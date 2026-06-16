# Ventas · Claudia Adorno SRL

Módulo que reemplaza la planilla Excel de ventas diarias. Carga automática desde
Dragonfish, planilla mensual por local, sistema de turnos con cruce contra MP.

## Qué hace

- **Planilla mensual** por local (Alcorta, Unicenter, Oficina) con:
  - Efectivo, Tarjeta (Clover, hasta jun/2026), MP (QR + Point), Vales
  - Shopping (suma física), Cant. transacciones, Online (negro), FC Oficina, Total
- **Sync automático** desde Dragonfish vía `sync_local` Python (60s polling).
- **Workflow de correcciones** vendedora → admin (`ventas_correcciones`).
- **Cierre de mes** que bloquea edición (trigger SQL).
- **Sistema de turnos**: cada turno cerrado guarda snapshot de valores + cruce
  fila por fila contra cuenta MP real para detectar discrepancias.
- **Integración Tesorería**: trigger sincroniza efectivo del día → caja del local.

## Stack

- **Frontend**: `index.html` PWA, vanilla JS + Supabase JS SDK
- **Backend**: Supabase (`kwwiykssrpabncpqtmwi`)
- **Sync local**: Python en cada server Dragonfish (`sync_local/sync_ventas_local.py`)
- **Edge Functions**: `ventas-enviar-push`, `sync-ventas-sheets`

## Estructura del repo

```
ventas-adorno/
├── index.html              # PWA completa con turnos
├── service-worker.js
├── manifest.webmanifest
├── deploy.ps1
├── sql/                    # gitignored
│   ├── 00_install.sql      # schema base
│   ├── 01_carga_inicial_excel.sql
│   ├── 02_cierre_mes.sql
│   ├── 03_correcciones.sql # workflow vendedora→admin
│   ├── 04_turnos.sql       # turnos + cerrar_turno (post QA 16/06)
│   └── 05_transacciones.sql # cruce MP fila por fila
└── sync_local/             # gitignored
    ├── sync_ventas_local.py
    ├── .env.example
    ├── install_task.bat
    ├── install_alcorta.bat # auto-instalador
    └── install_oficina.bat # auto-instalador
```

## Instalación en server de un local

1. Copiar `sync_local/` entero al server del local.
2. Botón derecho → **Ejecutar como administrador** sobre `install_alcorta.bat`
   o `install_oficina.bat`.
3. Pegar `SUPABASE_SERVICE_KEY` cuando lo pida.
4. El script verifica Python, instala `pyodbc + requests`, configura `.env`,
   instala tarea Windows.

`.env` típico:
```
VENTAS_LOCAL=alcorta
VENTAS_SQL_SERVER=localhost\ZOOLOGIC2026
SUPABASE_URL=https://kwwiykssrpabncpqtmwi.supabase.co
SUPABASE_SERVICE_KEY=...
POLL_SECONDS=60
```

## Cómo funciona el sync Dragonfish

`sync_ventas_local.py` polleea `dragonfish_jobs` cada 60s. Cuando hay un job,
consulta SQL Server local con Windows auth:

```sql
-- VAL (desglose por método de pago):
JJCO LIKE '0%'  → efectivo
JJCO LIKE 'TJ%' → tarjeta (Clover, en desuso desde 07/2026)
JJCO LIKE 'QR%' → MP (point + QR)
JJCO LIKE 'VC%' → vales

-- COMPROBANTEV:
COUNT(*)    → cant_transacciones
SUM(FTOTAL) → online (DB_ONLINE bases _2)
```

Bases por local:
- **alcorta**: `DRAGONFISH_ALCO1` (física/blanco) + `DRAGONFISH_ALCO2` (online/negro)
- **unicenter**: `DRAGONFISH_UNI1` + `DRAGONFISH_UNI2`
- **oficina**: `DRAGONFISH_ADMIN` (única)

El sync sube via `supa_bulk_upsert_ventas` (1 request por mes) a `ventas_diarias`
+ `supa_bulk_upsert_transacciones` para cada MP individual a `ventas_transacciones`
(detalle para cruce fila por fila al cerrar turno).

## Sistema de turnos

### Workflow

1. Día arranca: `ventas_diarias` se actualiza c/60s con totales del día.
2. Chica turno mañana cierra (~16hs) → click **🔒 Cerrar** en fila del día.
3. PWA llama `sync-mp-on-demand` (refresh pagos MP recientes) → `cerrar_turno()` RPC.
4. `cerrar_turno()`:
   - `numero = max(numero del día) + 1`
   - `desde = max(hasta turno anterior) o medianoche BA`
   - `hasta = NOW()`
   - Valores = ventas_diarias actual − suma turnos previos
   - Cruza con `tesoreria_movimientos` (cuenta MP Locales, local, rango por
     `extra.date_approved` + margen 15min)
   - Cruza fila por fila contra `ventas_transacciones`
5. Chica turno noche entra. Al cerrar → Turno 2 automático.
6. **Findes y Oficina**: típicamente 1 turno.

### Salida del modal de cierre

- Cuadro **Cruce con cuenta Mercado Pago**: Dragonfish vs MP cuenta vs diferencia.
- Si discrepancia: comparación lado a lado con ✓ verde (match) / ✗ rojo (no-match).
- Match = importe igual + hora ±5min.
- Summary con counts `cuenta_sin_match` y `df_sin_match`.

## Tablas Supabase

| Tabla | Rol |
|---|---|
| `ventas_diarias` | Agregado del día por local (UNIQUE local+fecha) |
| `dragonfish_jobs` | Cola de syncs pendientes |
| `meses_cerrados_ventas` | Bloqueo de edición por mes cerrado |
| `ventas_correcciones` | Workflow correcciones vendedora→admin |
| `ventas_correcciones_aplicadas` | Histórico de correcciones aprobadas |
| `ventas_turnos` | Cada turno cerrado |
| `ventas_turnos_view` | View con shopping_turno/total_turno/estado_discrepancia |
| `ventas_transacciones` | Una fila por transacción Dragonfish (cruce MP) |

## Conceptos clave

### MP renombre + Tarjeta en desuso

- Hasta **30/06/2026** inclusive: columna **Tarjeta** visible (Clover).
- Desde **01/07/2026**: Tarjeta desaparece de la UI (campo en DB sigue para
  histórico). Variable `FECHA_FIN_TARJETA = '2026-06-30'` en `index.html:723`.
- Header viejo "QR (MP)" → **"MP"** (engloba QR + Point MP).

### Cruce fila por fila

`cerrar_turno()` lee 2 listas (cuenta MP Locales vs ventas_transacciones),
matchea por `importe + hora ±5min`, reporta `tiene_match` en cada lado.

Casos:
- ✗ MP cuenta sin match: pago entró a MP pero Dragonfish no lo registró
  (¿venta no cargada en POS?).
- ✗ Dragonfish sin match: venta marcada en POS pero no llegó a MP
  (¿en proceso? ¿anulada? ¿lag del sync?).

## Troubleshooting

### "El sync_local no escribe a la DB"
1. `schtasks /Query /TN "Ventas_Adorno_SyncLocal"`
2. `type C:\CRM_Adorno\ventas-adorno\sync_local\sync.log`
3. "Cannot connect to SQL Server" → permisos `db_datareader` del usuario Windows
4. "401 unauthorized" → rotar `SUPABASE_SERVICE_KEY` en `.env`

### "Click 'Cerrar turno' no abre modal"
1. Network del browser, click botón.
2. 500 en `cerrar_turno` → `ventas_diarias` del día vacía (esperar sync o cargar manual).
3. 401 en `sync-mp-on-demand` → edge function sin secret `MP_LOCALES_TOKEN`.

### "Discrepancia siempre da -X"
- MP cuenta 0, Dragonfish X: scraper MP no corrió aún. Esperar 1h o invocar manual.
- MP cuenta X, Dragonfish 0: cargar venta manual en Dragonfish.

### "Vendedora clickea Cerrar y no pasa nada"
- RLS: chequear que `rrhh_usuarios.local_id` matchee el local de la planilla.

## Pendientes activos

- Mañana 17/06: instalar sync_local en Alcorta y Oficina (Unicenter ya).
- Mover hardcoded `FECHA_FIN_TARJETA`, `STORE_A_LOCAL`, `POS_NAMES` a tabla config.
- Healthcheck del sync_local (badge rojo en PWA si last_seen > 5min).
- Lock advisory en `cerrar_turno` (concurrencia: 2 chicas a la vez).
- Verificar turno cruzando 00:00.

Ver `C:\CRM_Adorno\SESSIONS.md` para historial.
