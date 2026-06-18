-- ═══════════════════════════════════════════════════════════════════════
-- MÓDULO VENTAS · Número de comprobante en ventas_transacciones
-- ═══════════════════════════════════════════════════════════════════════
-- Agrega el N° de comprobante (ej "B 0020-00055483") a cada transacción
-- individual. Sirve para que al cerrar turno, si hay discrepancia con MP,
-- se vea EXACTAMENTE qué factura es la que tiene el problema.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE ventas_transacciones
    ADD COLUMN IF NOT EXISTS numero_comprobante text;

COMMENT ON COLUMN ventas_transacciones.numero_comprobante IS
'N° de factura/ticket en formato legible: "B 0020-00055483". Se llena desde el sync con JOIN a COMPROBANTEV (FLETRA/FPTOVEN/FNUMCOMP).';

-- ═══════════════════════════════════════════════════════════════════════
-- Modificar cerrar_turno() para incluir numero_comprobante en mp_movs_no_match
-- ═══════════════════════════════════════════════════════════════════════
-- Re-creamos solo el bloque del SELECT/jsonb_build_object que arma txs_df.
-- El resto de la función queda igual.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cerrar_turno(
    p_local       text,
    p_fecha       date,
    p_cerrado_por text DEFAULT NULL,
    p_notas       text DEFAULT NULL
)
RETURNS ventas_turnos
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_resultado   ventas_turnos;
    v_numero      int;
    v_desde       timestamptz;
    v_hasta       timestamptz;
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
    v_cuenta_mp   bigint;
    v_mp_cuenta   numeric;
    v_discrep     numeric;
    v_no_match    jsonb;
BEGIN
    -- 1) Cargar día
    SELECT * INTO v_vd FROM ventas_diarias
    WHERE local = p_local AND fecha = p_fecha;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay ventas para % en %', p_local, p_fecha;
    END IF;

    -- 2) Numero de turno = siguiente
    SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
    FROM ventas_turnos WHERE local = p_local AND fecha = p_fecha;

    -- 3) Rango horario
    -- desde = hasta del último turno o 00:00 del día (BA)
    SELECT MAX(hasta) INTO v_desde
    FROM ventas_turnos WHERE local = p_local AND fecha = p_fecha;
    IF v_desde IS NULL THEN
        v_desde := (p_fecha::text || ' 00:00')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires';
    END IF;
    v_hasta := NOW();
    -- Margen de gracia: 15 min después del click para tolerar movs MP procesados
    v_hasta_mp := v_hasta + INTERVAL '15 minutes';

    -- 4) Snapshot: día - turnos previos
    SELECT
        COALESCE(SUM(efectivo), 0)           AS efe,
        COALESCE(SUM(tarjeta), 0)           AS tarj,
        COALESCE(SUM(qr), 0)                AS qr_,
        COALESCE(SUM(vales), 0)             AS val,
        COALESCE(SUM(online), 0)            AS onl,
        COALESCE(SUM(fc_oficina), 0)        AS fcof,
        COALESCE(SUM(cant_transacciones), 0) AS ctx
    INTO v_prev
    FROM ventas_turnos
    WHERE local = p_local AND fecha = p_fecha;

    v_efectivo   := COALESCE(v_vd.efectivo, 0)   - v_prev.efe;
    v_tarjeta    := COALESCE(v_vd.tarjeta, 0)    - v_prev.tarj;
    v_qr         := COALESCE(v_vd.qr, 0)         - v_prev.qr_;
    v_vales      := COALESCE(v_vd.vales, 0)      - v_prev.val;
    v_online     := COALESCE(v_vd.online, 0)     - v_prev.onl;
    v_fc_oficina := COALESCE(v_vd.fc_oficina, 0) - v_prev.fcof;
    v_cant       := COALESCE(v_vd.cant_transacciones, 0) - v_prev.ctx;

    -- 5) Buscar la cuenta MP Locales
    SELECT id INTO v_cuenta_mp
    FROM tesoreria_cuentas
    WHERE nombre = 'MP Locales' AND tipo = 'mp'
    LIMIT 1;

    -- 6) CRUCE MP detallado (igual que antes, pero ahora incluyendo numero_comprobante)
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
            SELECT t.id, t.importe, t.aprobado_at AS hora,
                   t.codigo_jjco, t.base, t.numero_comprobante
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
                        'numero_comprobante', numero_comprobante,
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

    -- 7) Insertar
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
$$;

NOTIFY pgrst, 'reload schema';
