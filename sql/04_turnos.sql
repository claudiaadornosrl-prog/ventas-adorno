-- ═══════════════════════════════════════════════════════════════════════
-- MÓDULO VENTAS · Turnos
-- ═══════════════════════════════════════════════════════════════════════
-- Permite "abrir" la fila de un día en sus turnos (1 turno, 2 turnos, o más).
--   - ventas_diarias sigue siendo el agregado del día (compatible con todo).
--   - ventas_turnos guarda cada cierre individual con su rango horario.
--   - Trigger en ventas_turnos actualiza ventas_diarias automáticamente.
--
-- Workflow:
--   1) Las ventas se sincronizan en ventas_diarias como hoy (sync_local 60s).
--   2) Cuando la encargada cierra turno (botón en PWA), llama cerrar_turno().
--      → snapshot: valores = (totales actuales del día) - (turnos ya cerrados).
--      → rango horario: desde = max(hasta) del último turno o 00:00, hasta = NOW.
--   3) Próximo turno arranca implícito desde el cierre anterior.
--   4) No hay "cerrar día" — el día queda cerrado a las 00:00 del día siguiente.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas_turnos (
    id                  bigserial PRIMARY KEY,
    local               text NOT NULL CHECK (local IN ('alcorta','unicenter','oficina')),
    fecha               date NOT NULL,
    numero              int  NOT NULL,                  -- 1, 2, 3...

    -- Rango horario del turno
    desde               timestamptz NOT NULL,           -- arranque (cierre anterior o 00:00)
    hasta               timestamptz NOT NULL,           -- cuando se cerró (= NOW al click)

    -- Valores DEL TURNO (no acumulado del día)
    efectivo            numeric(14,2) DEFAULT 0,
    tarjeta             numeric(14,2) DEFAULT 0,
    qr                  numeric(14,2) DEFAULT 0,        -- = MP (point + qr)
    vales               numeric(14,2) DEFAULT 0,
    online              numeric(14,2) DEFAULT 0,
    fc_oficina          numeric(14,2) DEFAULT 0,
    cant_transacciones  int DEFAULT 0,

    -- Cruce con Mercado Pago (calculado al cerrar)
    mp_cuenta           numeric(14,2),                  -- lo que llegó a MP real (por rango horario)
    discrepancia_mp     numeric(14,2),                  -- mp_cuenta - qr (campo QR = MP en dragonfish)
    mp_movs_no_match    jsonb,                          -- detalle de los movs MP que no aparecen en Dragonfish

    -- Meta
    cerrado_por         text,                           -- 'admin:juanpsimonelli@gmail.com' o 'local:alcorta'
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
-- Crea un registro en ventas_turnos con los valores del turno actual.
-- - numero = max(numero) + 1 del día/local, o 1 si es el primero.
-- - desde  = max(hasta) del turno anterior, o fecha a las 00:00.
-- - hasta  = NOW().
-- - valores = (ventas_diarias del día) - (sum de turnos previos del día).
--
-- Args:
--   p_local       text — 'alcorta' | 'unicenter' | 'oficina'
--   p_fecha       date — la fecha del día a cerrar el turno
--   p_cerrado_por text — quien cerró (email admin o 'local:<nombre>')
--   p_notas       text — opcional
--
-- Retorna la fila creada en ventas_turnos.
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
    -- 1) Buscar el último turno cerrado del día
    SELECT
        COALESCE(MAX(numero), 0) + 1                     AS sig_numero,
        COALESCE(MAX(hasta), (p_fecha::timestamp at time zone 'America/Argentina/Buenos_Aires')) AS desde_calc
    INTO v_numero, v_desde
    FROM ventas_turnos
    WHERE local = p_local AND fecha = p_fecha;

    -- 2) Sumar turnos previos del día para calcular el delta
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

    -- 4) Calcular valores del turno = totales del día - turnos previos
    v_efectivo   := COALESCE(v_vd.efectivo, 0)   - v_prev.efec;
    v_tarjeta    := COALESCE(v_vd.tarjeta, 0)    - v_prev.tarj;
    v_qr         := COALESCE(v_vd.qr, 0)         - v_prev.qr_;
    v_vales      := COALESCE(v_vd.vales, 0)      - v_prev.vales_;
    v_online     := COALESCE(v_vd.online, 0)     - v_prev.onl;
    v_fc_oficina := COALESCE(v_vd.fc_oficina, 0) - v_prev.fcof;
    v_cant       := COALESCE(v_vd.cant_transacciones, 0) - v_prev.ctx;

    -- 5) Cruzar con Mercado Pago (cuenta MP Locales = id 12)
    --    Sumar movs MP de la cuenta + local + rango horario del turno
    SELECT id INTO v_cuenta_mp
    FROM tesoreria_cuentas
    WHERE nombre = 'MP Locales' AND tipo = 'mp'
    LIMIT 1;

    IF v_cuenta_mp IS NOT NULL AND p_local IN ('alcorta','unicenter') THEN
        SELECT COALESCE(SUM(m.importe), 0) INTO v_mp_cuenta
        FROM tesoreria_movimientos m
        WHERE m.cuenta_id = v_cuenta_mp
          AND m.local = p_local
          AND m.fecha = p_fecha
          AND m.cargado_at BETWEEN v_desde AND v_hasta;

        v_discrep := v_mp_cuenta - v_qr;

        -- Detalle: listar movs MP del turno como JSON (para mostrar en PWA)
        SELECT jsonb_agg(jsonb_build_object(
            'id',          m.id,
            'fecha',       m.fecha,
            'importe',     m.importe,
            'canal',       m.canal,
            'pos_name',    m.extra->>'pos_name',
            'descripcion', LEFT(COALESCE(m.descripcion,''), 80),
            'cargado_at',  m.cargado_at
        ) ORDER BY m.cargado_at DESC)
        INTO v_no_match
        FROM tesoreria_movimientos m
        WHERE m.cuenta_id = v_cuenta_mp
          AND m.local = p_local
          AND m.fecha = p_fecha
          AND m.cargado_at BETWEEN v_desde AND v_hasta;
    END IF;

    -- 6) Insertar el turno
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
'Cierra el turno actual de un local. Calcula valores como (ventas_diarias - turnos previos del día), cruza con MP y devuelve la fila creada.';

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

-- ═══════════════════════════════════════════════════════════════════════
-- ¿Cómo usar?
-- ═══════════════════════════════════════════════════════════════════════
-- Desde la PWA (Supabase JS):
--   const { data, error } = await sb.rpc('cerrar_turno', {
--     p_local: 'alcorta',
--     p_fecha: '2026-06-16',
--     p_cerrado_por: session.email,
--     p_notas: null
--   });
--   data → la fila ventas_turnos recién creada (con discrepancia_mp y mp_movs_no_match)
--
-- Para ver los turnos de un día:
--   SELECT * FROM ventas_turnos_view
--   WHERE local='alcorta' AND fecha='2026-06-16'
--   ORDER BY numero;
