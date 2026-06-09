-- ═══════════════════════════════════════════════════════════════════════
-- 02. CIERRE DE MES + bloqueo de modificaciones
-- ═══════════════════════════════════════════════════════════════════════
-- Una vez cerrado el mes, NADIE (ni admin) puede modificar ventas_diarias
-- ni disparar jobs de sync hasta que se reabra.
-- Es la misma lógica que en RRHH para cierre de Sueldos.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meses_cerrados_ventas (
    id              bigserial PRIMARY KEY,
    local           text NOT NULL CHECK (local IN ('alcorta','unicenter','oficina')),
    "año"           int  NOT NULL CHECK ("año" BETWEEN 2024 AND 2100),
    mes             int  NOT NULL CHECK (mes BETWEEN 1 AND 12),
    cerrado_por     text NOT NULL,
    cerrado_at      timestamptz NOT NULL DEFAULT now(),
    observaciones   text,

    UNIQUE (local, "año", mes)
);

CREATE INDEX IF NOT EXISTS idx_mcv_local_periodo
    ON meses_cerrados_ventas(local, "año" DESC, mes DESC);

COMMENT ON TABLE meses_cerrados_ventas IS
'Cierre de mes por local. Si existe una fila para (local, año, mes), las ventas_diarias de ese período quedan bloqueadas para escritura.';

-- ═══════════════════════════════════════════════════════════════════════
-- Helper: ¿está cerrado el mes de esa fecha?
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ventas_mes_cerrado(p_local text, p_fecha date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM meses_cerrados_ventas
        WHERE local = p_local
          AND "año" = EXTRACT(YEAR FROM p_fecha)::int
          AND mes   = EXTRACT(MONTH FROM p_fecha)::int
    );
$$;

GRANT EXECUTE ON FUNCTION ventas_mes_cerrado(text, date) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Trigger en ventas_diarias: bloquear INSERT/UPDATE/DELETE si mes cerrado
-- (incluso para admin — para modificar hay que reabrir el mes primero)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_ventas_bloquear_mes_cerrado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_local text;
    v_fecha date;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_local := OLD.local; v_fecha := OLD.fecha;
    ELSE
        v_local := NEW.local; v_fecha := NEW.fecha;
    END IF;

    IF ventas_mes_cerrado(v_local, v_fecha) THEN
        RAISE EXCEPTION 'El mes % de % está cerrado. Para modificar, reabrir el mes primero.',
            to_char(v_fecha, 'YYYY-MM'), v_local
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_vd_bloquear ON ventas_diarias;
CREATE TRIGGER trg_vd_bloquear
    BEFORE INSERT OR UPDATE OR DELETE ON ventas_diarias
    FOR EACH ROW
    EXECUTE FUNCTION trg_ventas_bloquear_mes_cerrado();

-- ═══════════════════════════════════════════════════════════════════════
-- Trigger en dragonfish_jobs: no crear jobs sobre meses cerrados
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_dragonfish_bloquear_mes_cerrado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND ventas_mes_cerrado(NEW.local, NEW.fecha) THEN
        RAISE EXCEPTION 'El mes % de % está cerrado. No se puede pedir sync de Dragonfish.',
            to_char(NEW.fecha, 'YYYY-MM'), NEW.local
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dj_bloquear ON dragonfish_jobs;
CREATE TRIGGER trg_dj_bloquear
    BEFORE INSERT ON dragonfish_jobs
    FOR EACH ROW
    EXECUTE FUNCTION trg_dragonfish_bloquear_mes_cerrado();

-- ═══════════════════════════════════════════════════════════════════════
-- RLS en meses_cerrados_ventas: admin ALL, otros SELECT
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE meses_cerrados_ventas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcv_admin ON meses_cerrados_ventas;
DROP POLICY IF EXISTS mcv_read  ON meses_cerrados_ventas;

CREATE POLICY mcv_admin ON meses_cerrados_ventas FOR ALL
    USING (ventas_is_admin())
    WITH CHECK (ventas_is_admin());

-- Cualquiera autenticado puede leer (para que la UI sepa si está cerrado)
CREATE POLICY mcv_read ON meses_cerrados_ventas FOR SELECT
    USING (true);

GRANT SELECT ON meses_cerrados_ventas TO authenticated;
GRANT INSERT, DELETE, UPDATE ON meses_cerrados_ventas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE meses_cerrados_ventas_id_seq TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- RPCs cerrar / reabrir (solo admin)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ventas_cerrar_mes(p_local text, p_año int, p_mes int, p_obs text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email text;
    v_id    bigint;
BEGIN
    IF NOT ventas_is_admin() THEN
        RAISE EXCEPTION 'Solo admin puede cerrar mes';
    END IF;
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
    INSERT INTO meses_cerrados_ventas (local, "año", mes, cerrado_por, observaciones)
    VALUES (p_local, p_año, p_mes, COALESCE(v_email, 'admin'), p_obs)
    ON CONFLICT (local, "año", mes) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ventas_cerrar_mes(text, int, int, text) TO authenticated;

CREATE OR REPLACE FUNCTION ventas_reabrir_mes(p_local text, p_año int, p_mes int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
    IF NOT ventas_is_admin() THEN
        RAISE EXCEPTION 'Solo admin puede reabrir mes';
    END IF;
    DELETE FROM meses_cerrados_ventas
    WHERE local = p_local AND "año" = p_año AND mes = p_mes;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION ventas_reabrir_mes(text, int, int) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Soporte para jobs tipo "mes": agregar columna tipo + rango
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE dragonfish_jobs
    ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'dia' CHECK (tipo IN ('dia','mes')),
    ADD COLUMN IF NOT EXISTS fecha_desde date,
    ADD COLUMN IF NOT EXISTS fecha_hasta date;

COMMENT ON COLUMN dragonfish_jobs.tipo IS
'dia = sincroniza solo dragonfish_jobs.fecha. mes = sincroniza desde fecha_desde a fecha_hasta inclusive.';

-- ═══════════════════════════════════════════════════════════════════════
SELECT '✅ 02_cierre_mes.sql aplicado' AS status;
