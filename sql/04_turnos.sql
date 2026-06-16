-- ═══════════════════════════════════════════════════════════════════════
-- MÓDULO VENTAS · Turnos
-- ═══════════════════════════════════════════════════════════════════════
-- Permite "abrir" la fila de un día en sus turnos (1 turno, 2 turnos, o más).
--   - ventas_diarias sigue siendo el agregado del día (compatible con todo).
--   - ventas_turnos guarda cada cierre individual con su rango horario.
--
-- Workflow:
--   1) Las ventas se sincronizan en ventas_diarias como hoy (sync_local 60s).
--   2) Cuando la encargada cierra turno (botón en PWA), llama cerrar_turno().
--      → snapshot: valores = (totales actuales del día) - (turnos ya cerrados).
--      → rango horario: desde = max(hasta) del último turno o 00:00, hasta = NOW.
--      → cruza con MP por extra.date_approved + margen de gracia ±15min.
--      → compara fila por fila contra ventas_transacciones (Dragonfish detalle).
--   3) Próximo turno arranca implícito desde el cierre anterior.
--   4) No hay "cerrar día" — el día queda cerrado a las 00:00 del día siguiente.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas_turnos (
    id                  bigserial PRIMARY KEY,
    local               text NOT NULL CHECK (local IN ('alcorta','unicenter','oficina')),
    fecha               date NOT NULL,
    numero              int  NOT NULL,                  -- 1, 2, 3...
    desde               timestamptz NOT NULL,           -- arranque (cierre anterior o 00:00)
    hasta               timestamptz NOT NULL,           -- cuando se cerró (= NOW al click)
    efectivo            numeric(14,2) DEFAULT 0,
    tarjeta             numeric(14,2) DEFAULT 0,
    qr                  numeric(14,2) DEFAULT 0,        -- = MP (point + qr)
    vales               numeric(14,2) DEFAULT 0,
    online              numeric(14,2) DEFAULT 0,
    fc_oficina          numeric(14,2) DEFAULT 0,
    cant_transacciones  int DEFAULT 0,
    mp_cuenta           numeric(14,2),                  -- lo que llegó a MP real
    discrepancia_mp     numeric(14,2),                  -- mp_cuenta - qr
    mp_movs_no_match    jsonb,                          -- detalle de no-matches (movs_cuenta + txs_dragonfish + summary)
    cerrado_por         text,
    cerrado_at          timestamptz NOT NULL DEFAULT now(),
    notas               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (local, fecha, numero)
);

CREATE INDEX IF NOT EXISTS idx_vt_local_fecha ON ventas_turnos(local, fecha DESC, numero);
CREATE INDEX IF NOT EXISTS idx_vt_fecha       ON ventas_turnos(fecha DESC);

COMMENT ON TABLE ventas_turnos IS
'Cada turno cerrado de un local. Suma de turnos del día = ventas_diarias del día.';

-- ═══════════════════════════════════════════════════════════════════════
-- Función: cerrar_turno(local, fecha)
-- ═══════════════════════════════════════════════════════════════════════
-- Versión actualizada (post QA 16/06/2026):
--   - Cruce MP por extra.date_approved (no cargado_at) con fallback a cargado_at
--   - Margen de gracia 15min hacia adelante del cierre (timing del sync MP)
--   - Bug timezone medianoche BA arreglado
--   - Detalle fila por fila contra ventas_transacciones (matches/no-matches)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cerrar_turno(
    p_local       text,
    p_fecha       date,
    p_cerrado_por text DEFAULT NULL,
    p_notas       text DEFAULT NULL
) RETURNS ventas_turnos AS $$
DECLARE
    v_numero      int;
    v_desde       timestamptz;
    v_hasta       timestamptz := now();
    v_hasta_mp    timestamptz;
    v_vd          ventas_diarias%ROWTYPE;
    v_prev        record;
    v_efectivo    numeric;
    v_tarjeta     numeric;
    v_qr          numeric;
    v_vales       numeric;
    v_online      numeric;
    v_fc_oficina  numeric;
    v_cant        int;
    v_mp_cuenta   numeric;
    v_discrep     numeric;
    v_no_match    jsonb;
    v_cuenta_mp   bigint;
    v_resultado   ventas_turnos%ROWTYPE;
BEGIN
    -- 1) Calcular número de turno y desde (cierre anterior o medianoche BA)
    -- FIX timezone: (p_fecha::text || ' 00:00')::timestamp AT TIME ZONE 'BA'
    -- representa correctamente las 00:00 del día en hora Argentina.
    SELECT
        COALESCE(MAX(numero), 0) + 1,
        COALESCE(
            MAX(hasta),
            ((p_fecha::text || ' 00:00')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
        )
    INTO v_numero, v_desde
    FROM ventas_turnos
    WHERE local = p_local AND fecha = p_fecha;

    -- Margen de gracia: 15 min después del click para tolerar movs MP procesados
    -- en los últimos segundos antes del cierre que aún no llegaron al scraper.
    v_hasta_mp := v_hasta + INTERVAL '15 minutes';

    -- 2) Sumar turnos previos del día
    SELECT
        COALESCE(SUM(efectivo), 0)          AS efec,
        COALESCE(SUM(tarjeta), 0)           AS tarj,
        COALESCE(SUM(qr), 0)                AS qr_,
        COALESCE(SUM(vales), 0)             AS vales_,
        COALESCE(SUM(online), 0)            AS onl,
        COALESCE(SUM(fc_oficina), 0)        AS fcof,
        COALESCE(SUM(cant_transacciones), 0) AS ctx
    INTO v_prev
    FROM ventas_turnos
    WHERE local = p_local AND fecha = p_fecha;

    -- 3) Leer ventas_diarias actual del día
    SELECT * INTO v_vd
    FROM ventas_diarias
    WHERE local = p_local AND fecha = p_fecha;

    IF v_vd.id IS NULL THEN
        RAISE EXCEPTION 'No hay datos en ventas_diarias para % %', p_local, p_fecha
            USING HINT = 'Esperar al próximo sync (60s) o cargar manual primero.';
    END IF;

    -- 4) Delta = totales del día - turnos previos
    v_efectivo   := COALESCE(v_vd.efectivo, 0)   - v_prev.efec;
    v_tarjeta    := COALESCE(v_vd.tarjeta, 0)    - v_prev.tarj;
    v_qr         := COALESCE(v_vd.qr, 0)         - v_prev.qr_;
    v_vales      := COALESCE(v_vd.vales, 0)      - v_prev.vales_;
    v_online     := COALESCE(v_vd.online, 0)     - v_prev.onl;
    v_fc_oficina := COALESCE(v_vd.fc_oficina, 0) - v_prev.fcof;
    v_cant       := COALESCE(v_vd.cant_transacciones, 0) - v_prev.ctx;

    -- 5) Buscar la cuenta MP Locales
    SELECT id INTO v_cuenta_mp
    FROM tesoreria_cuentas
    WHERE nombre = 'MP Locales' AND tipo = 'mp'
    LIMIT 1;

    -- 6) CRUCE MP detallado: comparar 2 listas (cuenta MP vs Dragonfish)
    --    - movs_cuenta: tesoreria_movimientos del rango horario del turno
    --    - txs_dragonfish: ventas_transacciones del mismo rango
    --    Match por importe + hora ±5min. Reporta tiene_match en cada lado.
    IF v_cuenta_mp IS NOT NULL AND p_local IN ('alcorta','unicenter') THEN
        WITH movs_cuenta AS (
            SELECT m.id, m.importe,
                   COALESCE((m.extra->>'date_approved')::timestamptz, m.cargado_at) AS hora,
                   m.canal,
                   m.extra->>'pos_name' AS pos_name
            FROM tesoreria_movimientos m
            WHERE m.cuenta_id = v_cuenta_mp
              AND m.local = p_local
              AND m.fecha = p_fecha
              AND COALESCE((m.extra->>'date_approved')::timestamptz, m.cargado_at)
                  BETWEEN v_desde AND v_hasta_mp
        ),
        txs_df AS (
            SELECT t.id, t.importe, t.aprobado_at AS hora, t.codigo_jjco, t.base
            FROM ventas_transacciones t
            WHERE t.local = p_local
              AND t.fecha = p_fecha
              AND t.tipo = 'mp'
              AND t.aprobado_at BETWEEN v_desde AND v_hasta_mp
        ),
        cuenta_con_flag AS (
            SELECT mc.*, EXISTS(
                SELECT 1 FROM txs_df td
                WHERE td.importe = mc.importe
                  AND ABS(EXTRACT(EPOCH FROM (td.hora - mc.hora))) < 300
            ) AS tiene_match
            FROM movs_cuenta mc
        ),
        df_con_flag AS (
            SELECT td.*, EXISTS(
                SELECT 1 FROM movs_cuenta mc
                WHERE mc.importe = td.importe
                  AND ABS(EXTRACT(EPOCH FROM (td.hora - mc.hora))) < 300
            ) AS tiene_match
            FROM txs_df td
        )
        SELECT
            (SELECT COALESCE(SUM(importe), 0) FROM movs_cuenta),
            jsonb_build_object(
                'movs_cuenta', COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object(
                        'id', id, 'hora', hora, 'importe', importe,
                        'canal', canal, 'pos_name', pos_name,
                        'tiene_match', tiene_match
                    ) ORDER BY hora) FROM cuenta_con_flag),
                    '[]'::jsonb),
                'txs_dragonfish', COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object(
                        'id', id, 'hora', hora, 'importe', importe,
                        'codigo_jjco', codigo_jjco, 'base', base,
                        'tiene_match', tiene_match
                    ) ORDER BY hora) FROM df_con_flag),
                    '[]'::jsonb),
                'summary', jsonb_build_object(
                    'cuenta_n',   (SELECT COUNT(*) FROM movs_cuenta),
                    'cuenta_sum', (SELECT COALESCE(SUM(importe),0) FROM movs_cuenta),
                    'df_n',       (SELECT COUNT(*) FROM txs_df),
                    'df_sum',     (SELECT COALESCE(SUM(importe),0) FROM txs_df),
                    'cuenta_sin_match', (SELECT COUNT(*) FROM cuenta_con_flag WHERE NOT tiene_match),
                    'df_sin_match',     (SELECT COUNT(*) FROM df_con_flag WHERE NOT tiene_match)
                )
            )
        INTO v_mp_cuenta, v_no_match;

        v_discrep := v_mp_cuenta - v_qr;
    END IF;

    -- 7) Insertar el turno
    INSERT INTO ventas_turnos (
        local, fecha, numero,
        desde, hasta,
        efectivo, tarjeta, qr, vales, online, fc_oficina, cant_transacciones,
        mp_cuenta, discrepancia_mp, mp_movs_no_match,
        cerrado_por, notas
    ) VALUES (
        p_local, p_fecha, v_numero,
        v_desde, v_hasta,
        v_efectivo, v_tarjeta, v_qr, v_vales, v_online, v_fc_oficina, v_cant,
        v_mp_cuenta, v_discrep, v_no_match,
        COALESCE(p_cerrado_por, current_setting('request.jwt.claims', true)::jsonb->>'email', 'desconocido'),
        p_notas
    )
    RETURNING * INTO v_resultado;

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cerrar_turno(text, date, text, text) TO authenticated;

COMMENT ON FUNCTION cerrar_turno IS
'Cierra el turno actual de un local. Calcula valores como (ventas_diarias - turnos previos del día), cruza con MP fila por fila contra ventas_transacciones y devuelve la fila creada.';

-- ═══════════════════════════════════════════════════════════════════════
-- Vista: turnos del día con discrepancia visible
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW ventas_turnos_view AS
SELECT
    t.*,
    (t.efectivo + t.tarjeta + t.qr + t.vales)            AS shopping_turno,
    (t.efectivo + t.tarjeta + t.qr + t.vales + t.online + t.fc_oficina) AS total_turno,
    CASE
      WHEN t.discrepancia_mp IS NULL              THEN NULL
      WHEN ABS(t.discrepancia_mp) < 1             THEN 'ok'
      WHEN ABS(t.discrepancia_mp) < 1000          THEN 'menor'
      ELSE 'alta'
    END AS estado_discrepancia
FROM ventas_turnos t
ORDER BY t.fecha DESC, t.local, t.numero;

GRANT SELECT ON ventas_turnos_view TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- RLS: misma política que ventas_diarias
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE ventas_turnos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vt_select ON ventas_turnos;
CREATE POLICY vt_select ON ventas_turnos FOR SELECT
    USING (
        ventas_is_admin()
        OR local = ventas_local_usuario()
    );

DROP POLICY IF EXISTS vt_insert ON ventas_turnos;
CREATE POLICY vt_insert ON ventas_turnos FOR INSERT
    WITH CHECK (
        ventas_is_admin()
        OR local = ventas_local_usuario()
    );

DROP POLICY IF EXISTS vt_update ON ventas_turnos;
CREATE POLICY vt_update ON ventas_turnos FOR UPDATE
    USING (ventas_is_admin())
    WITH CHECK (ventas_is_admin());

DROP POLICY IF EXISTS vt_delete ON ventas_turnos;
CREATE POLICY vt_delete ON ventas_turnos FOR DELETE
    USING (ventas_is_admin());

NOTIFY pgrst, 'reload schema';
