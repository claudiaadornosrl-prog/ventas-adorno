-- ═══════════════════════════════════════════════════════════════════════
-- MÓDULO VENTAS · Transacciones individuales (cruce Dragonfish vs MP)
-- ═══════════════════════════════════════════════════════════════════════
-- Una fila por transacción individual del Dragonfish (tabla VAL: JJFECHA +
-- JJCO + MONTOSISTE). Permite cruzar fila por fila con tesoreria_movimientos
-- al cerrar un turno y mostrar matches / no-matches.
--
-- Esta tabla se llena desde sync_local/sync_ventas_local.py
-- (función `consultar_transacciones_mp_rango`) que filtra JJCO LIKE 'QR%'
-- (MP). En el futuro podría sumar TJ% (tarjeta) y otros tipos.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas_transacciones (
    id              bigserial PRIMARY KEY,
    local           text NOT NULL CHECK (local IN ('alcorta','unicenter','oficina')),
    fecha           date NOT NULL,
    aprobado_at     timestamptz NOT NULL,   -- JJFECHA del Dragonfish (con hora)
    importe         numeric(14,2) NOT NULL,
    codigo_jjco     text NOT NULL,          -- ej: 'QR2', 'TJ01', '00'
    tipo            text NOT NULL CHECK (tipo IN ('mp','tarjeta','efectivo','vales')),
    base            text NOT NULL CHECK (base IN ('fisica','online')) DEFAULT 'fisica',
    hash_externo    text NOT NULL,
    cargado_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (local, hash_externo)
);

CREATE INDEX IF NOT EXISTS idx_vtx_local_fecha    ON ventas_transacciones(local, fecha);
CREATE INDEX IF NOT EXISTS idx_vtx_local_aprobado ON ventas_transacciones(local, aprobado_at);
CREATE INDEX IF NOT EXISTS idx_vtx_tipo_fecha     ON ventas_transacciones(tipo, fecha);

COMMENT ON TABLE ventas_transacciones IS
'Una fila por transacción individual de venta del Dragonfish (JJFECHA + JJCO + MONTOSISTE de la tabla VAL). Sirve para cruzar fila por fila con tesoreria_movimientos al cerrar un turno.';

COMMENT ON COLUMN ventas_transacciones.aprobado_at IS
'Timestamp completo de la transacción (de JJFECHA con hora). Usar este campo para cruzar con extra.date_approved de tesoreria_movimientos en cerrar_turno().';

-- ═══════════════════════════════════════════════════════════════════════
-- RLS: misma política que ventas_diarias
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE ventas_transacciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtx_select ON ventas_transacciones;
CREATE POLICY vtx_select ON ventas_transacciones FOR SELECT
    USING (ventas_is_admin() OR local = ventas_local_usuario());

-- El sync_local usa service_role_key (bypassa RLS), así que el INSERT
-- queda abierto pero protegido por el service_role en la práctica.
DROP POLICY IF EXISTS vtx_insert ON ventas_transacciones;
CREATE POLICY vtx_insert ON ventas_transacciones FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS vtx_update ON ventas_transacciones;
CREATE POLICY vtx_update ON ventas_transacciones FOR UPDATE
    USING (ventas_is_admin())
    WITH CHECK (ventas_is_admin());

DROP POLICY IF EXISTS vtx_delete ON ventas_transacciones;
CREATE POLICY vtx_delete ON ventas_transacciones FOR DELETE
    USING (ventas_is_admin());

NOTIFY pgrst, 'reload schema';
