-- ═══════════════════════════════════════════════════════════════════════
-- MÓDULO VENTAS · Solicitudes de reapertura de día
-- ═══════════════════════════════════════════════════════════════════════
-- Cuando un día está cerrado (controlado=true), las vendedoras NO pueden
-- modificar más nada — ni el sync mensual lo pisa. Si después aparece una
-- diferencia, la vendedora puede solicitar la reapertura del día. El admin
-- (JP) aprueba o rechaza desde la bandeja de pendientes.
--
-- Cuando admin APRUEBA:
--   - Se ejecuta reabrir_dia() → controlado=false
--   - La próxima "Resincronizar mes" SÍ va a procesar ese día
--
-- Cuando admin RECHAZA: queda registrado pero el día sigue cerrado.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas_reaperturas (
    id              bigserial PRIMARY KEY,
    local           text NOT NULL CHECK (local IN ('alcorta','unicenter','oficina')),
    fecha           date NOT NULL,
    solicitado_por  text NOT NULL,
    solicitado_at   timestamptz NOT NULL DEFAULT now(),
    motivo          text NOT NULL,
    estado          text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','aprobada','rechazada')),
    resuelto_por    text,
    resuelto_at     timestamptz,
    comentario_admin text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vr_pendientes
    ON ventas_reaperturas(estado, solicitado_at DESC)
    WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_vr_local_fecha
    ON ventas_reaperturas(local, fecha DESC);

COMMENT ON TABLE ventas_reaperturas IS
'Bandeja de solicitudes de reapertura de día. La vendedora solicita, admin aprueba o rechaza.';

-- ═══════════════════════════════════════════════════════════════════════
-- Función: solicitar_reapertura
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION solicitar_reapertura(
    p_local  text,
    p_fecha  date,
    p_motivo text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_solicitante  text;
    v_controlado   boolean;
    v_id           bigint;
    v_existente    bigint;
BEGIN
    -- Identificar quién solicita
    v_solicitante := COALESCE(
        current_setting('request.jwt.claims', true)::jsonb->>'email',
        'desconocido'
    );

    IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
        RAISE EXCEPTION 'El motivo debe tener al menos 5 caracteres';
    END IF;

    -- Validar que el día esté cerrado
    SELECT controlado INTO v_controlado
    FROM ventas_diarias
    WHERE local = p_local AND fecha = p_fecha;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay ventas para % en %', p_local, p_fecha;
    END IF;

    IF NOT v_controlado THEN
        RAISE EXCEPTION 'El día % de % no está cerrado, no necesita reapertura', p_fecha, p_local;
    END IF;

    -- Si ya hay una solicitud pendiente para ese local/fecha, evitar duplicado
    SELECT id INTO v_existente
    FROM ventas_reaperturas
    WHERE local = p_local AND fecha = p_fecha AND estado = 'pendiente'
    LIMIT 1;

    IF v_existente IS NOT NULL THEN
        RAISE EXCEPTION 'Ya hay una solicitud pendiente para ese día (id=%)', v_existente;
    END IF;

    INSERT INTO ventas_reaperturas (local, fecha, solicitado_por, motivo)
    VALUES (p_local, p_fecha, v_solicitante, trim(p_motivo))
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION solicitar_reapertura(text, date, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Función: resolver_reapertura (solo admin)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION resolver_reapertura(
    p_id          bigint,
    p_aprobar     boolean,
    p_comentario  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_es_admin boolean;
    v_sol      ventas_reaperturas%ROWTYPE;
    v_admin    text;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM rrhh_usuarios
        WHERE auth_user_id = auth.uid()
          AND rol = 'admin' AND activo = true
    ) INTO v_es_admin;

    IF NOT v_es_admin THEN
        RAISE EXCEPTION 'Solo admin puede resolver una solicitud de reapertura';
    END IF;

    v_admin := COALESCE(
        current_setting('request.jwt.claims', true)::jsonb->>'email',
        'admin'
    );

    SELECT * INTO v_sol FROM ventas_reaperturas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitud % no existe', p_id;
    END IF;
    IF v_sol.estado <> 'pendiente' THEN
        RAISE EXCEPTION 'Solicitud % ya fue resuelta (estado=%)', p_id, v_sol.estado;
    END IF;

    UPDATE ventas_reaperturas
    SET estado = CASE WHEN p_aprobar THEN 'aprobada' ELSE 'rechazada' END,
        resuelto_por = v_admin,
        resuelto_at = NOW(),
        comentario_admin = p_comentario
    WHERE id = p_id;

    -- Si aprueba, reabrir el día efectivamente
    IF p_aprobar THEN
        UPDATE ventas_diarias
        SET controlado = false,
            controlado_at = NULL,
            controlado_por = NULL
        WHERE local = v_sol.local AND fecha = v_sol.fecha;
    END IF;

    RETURN jsonb_build_object(
        'id', p_id,
        'estado', CASE WHEN p_aprobar THEN 'aprobada' ELSE 'rechazada' END,
        'local', v_sol.local,
        'fecha', v_sol.fecha,
        'dia_reabierto', p_aprobar
    );
END;
$$;

GRANT EXECUTE ON FUNCTION resolver_reapertura(bigint, boolean, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE ventas_reaperturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vr_select ON ventas_reaperturas;
CREATE POLICY vr_select ON ventas_reaperturas
    FOR SELECT TO authenticated
    USING (
        -- Admin ve todo, otros ven solo sus propias solicitudes
        EXISTS (SELECT 1 FROM rrhh_usuarios u WHERE u.auth_user_id = auth.uid() AND u.rol = 'admin' AND u.activo = true)
        OR solicitado_por = (current_setting('request.jwt.claims', true)::jsonb->>'email')
    );

-- No hay INSERT/UPDATE/DELETE policies — todo va por las funciones
-- solicitar_reapertura() y resolver_reapertura() que son SECURITY DEFINER

-- ═══════════════════════════════════════════════════════════════════════
-- Reload schema cache
-- ═══════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
