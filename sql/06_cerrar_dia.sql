-- ═══════════════════════════════════════════════════════════════════════
-- MÓDULO VENTAS · Cerrar día
-- ═══════════════════════════════════════════════════════════════════════
-- Cuando la encargada toca "🏁 Cerrar Día":
--   1) Si hay ventas pendientes (no cerradas en turno), cierra automáticamente
--      el turno final con todo lo restante del día (cruce MP incluido).
--   2) Marca el día como controlado=true en ventas_diarias (lock).
--   3) Después de eso, los botones "Cerrar Turno" y "Cerrar Día" NO aparecen
--      más en la PWA hasta que admin reabra el día.
--
-- El cierre del día NO bloquea el sync_local: la grilla puede seguir
-- recibiendo ajustes de Dragonfish (raros, ej. una corrección retroactiva).
-- Solo bloquea NUEVOS turnos manuales.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cerrar_dia(
    p_local       text,
    p_fecha       date,
    p_cerrado_por text DEFAULT NULL,
    p_notas       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vd            ventas_diarias%ROWTYPE;
    v_total_dia     numeric;
    v_total_turnos  numeric;
    v_pendiente     numeric;
    v_turno_nuevo   jsonb := NULL;
    v_cerrado_por   text;
    v_turno_record  ventas_turnos%ROWTYPE;
BEGIN
    -- ── 0) Resolver cerrado_por (parámetro o email del JWT) ─────────
    v_cerrado_por := COALESCE(
        p_cerrado_por,
        current_setting('request.jwt.claims', true)::jsonb->>'email',
        'desconocido'
    );

    -- ── 1) Validar que el día exista y no esté ya cerrado ───────────
    SELECT * INTO v_vd
    FROM ventas_diarias
    WHERE local = p_local AND fecha = p_fecha;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay ventas para % en %', p_local, p_fecha;
    END IF;

    IF v_vd.controlado THEN
        RAISE EXCEPTION 'El día % de % ya está cerrado (controlado_por=%)',
            p_fecha, p_local, v_vd.controlado_por;
    END IF;

    -- ── 2) Calcular si quedan ventas sin cerrar en algún turno ──────
    v_total_dia := COALESCE(v_vd.efectivo, 0) + COALESCE(v_vd.tarjeta, 0)
                 + COALESCE(v_vd.qr, 0) + COALESCE(v_vd.vales, 0)
                 + COALESCE(v_vd.online, 0) + COALESCE(v_vd.fc_oficina, 0);

    SELECT COALESCE(SUM(
        COALESCE(efectivo, 0) + COALESCE(tarjeta, 0)
        + COALESCE(qr, 0) + COALESCE(vales, 0)
        + COALESCE(online, 0) + COALESCE(fc_oficina, 0)
    ), 0) INTO v_total_turnos
    FROM ventas_turnos
    WHERE local = p_local AND fecha = p_fecha;

    v_pendiente := v_total_dia - v_total_turnos;

    -- ── 3) Si hay ventas pendientes (>$1 de tolerancia), cerrar turno ──
    IF v_pendiente > 1 THEN
        SELECT * INTO v_turno_record FROM cerrar_turno(
            p_local       => p_local,
            p_fecha       => p_fecha,
            p_cerrado_por => v_cerrado_por,
            p_notas       => COALESCE(p_notas, 'Turno final del día (auto al cerrar día)')
        );
        v_turno_nuevo := to_jsonb(v_turno_record);
    END IF;

    -- ── 4) Marcar el día como controlado ─────────────────────────────
    UPDATE ventas_diarias
    SET controlado    = true,
        controlado_at = NOW(),
        controlado_por = v_cerrado_por
    WHERE local = p_local AND fecha = p_fecha;

    -- ── 5) Resultado ─────────────────────────────────────────────────
    RETURN jsonb_build_object(
        'dia',              p_fecha,
        'local',            p_local,
        'controlado',       true,
        'controlado_por',   v_cerrado_por,
        'controlado_at',    NOW(),
        'turno_creado',     v_turno_nuevo,
        'pendiente_cerrado', v_pendiente
    );
END;
$$;

GRANT EXECUTE ON FUNCTION cerrar_dia(text, date, text, text) TO authenticated;

COMMENT ON FUNCTION cerrar_dia IS
'Cierra el día: si hay ventas pendientes (no cerradas en turno) cierra automáticamente un turno final, y luego marca el día como controlado=true. Después de eso no se pueden cerrar más turnos hasta que admin lo reabra.';

-- ═══════════════════════════════════════════════════════════════════════
-- Función auxiliar: reabrir día (solo admin)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION reabrir_dia(
    p_local text,
    p_fecha date,
    p_por   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_es_admin boolean;
    v_por      text;
BEGIN
    -- Solo admin puede reabrir un día
    SELECT EXISTS (
        SELECT 1 FROM rrhh_usuarios
        WHERE auth_user_id = auth.uid()
          AND rol = 'admin' AND activo = true
    ) INTO v_es_admin;

    IF NOT v_es_admin THEN
        RAISE EXCEPTION 'Solo admin puede reabrir un día cerrado';
    END IF;

    v_por := COALESCE(
        p_por,
        current_setting('request.jwt.claims', true)::jsonb->>'email',
        'admin'
    );

    UPDATE ventas_diarias
    SET controlado    = false,
        controlado_at = NULL,
        controlado_por = NULL
    WHERE local = p_local AND fecha = p_fecha;
END;
$$;

GRANT EXECUTE ON FUNCTION reabrir_dia(text, date, text) TO authenticated;

COMMENT ON FUNCTION reabrir_dia IS
'Reabre un día previamente cerrado (solo admin). Vuelve a permitir cerrar turnos en ese día.';
