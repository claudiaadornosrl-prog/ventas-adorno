-- ═══════════════════════════════════════════════════════════════════════
-- MÓDULO VENTAS · Schema base
-- ═══════════════════════════════════════════════════════════════════════
-- Tabla única ventas_diarias = fuente de verdad para:
--   - Planilla mensual por local (reemplaza el Excel)
--   - Planilla anual consolidada
--   - Módulo Caja (alimenta el ingreso por venta de efectivo del día)
--   - Módulo Gastos (prorrateo por % de venta de cada local)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas_diarias (
    id                  bigserial PRIMARY KEY,
    local               text NOT NULL CHECK (local IN ('alcorta','unicenter','oficina')),
    fecha               date NOT NULL,

    -- Cargas del Dragonfish (manual hoy, automático en Fase B)
    efectivo            numeric(14,2) DEFAULT 0,
    tarjeta             numeric(14,2) DEFAULT 0,
    qr                  numeric(14,2) DEFAULT 0,    -- = Mercado Pago QR
    vales               numeric(14,2) DEFAULT 0,
    cant_transacciones  int DEFAULT 0,

    -- Venta online (web) y factura de oficina (otra venta)
    online              numeric(14,2) DEFAULT 0,
    fc_oficina          numeric(14,2) DEFAULT 0,

    -- Flag de control (en Excel era "Controlado / True")
    controlado          boolean DEFAULT false,
    controlado_por      text,
    controlado_at       timestamptz,

    -- Auditoría
    cargado_por         text,
    cargado_at          timestamptz DEFAULT now(),
    actualizado_at      timestamptz DEFAULT now(),

    -- Origen del dato (manual o sync Dragonfish)
    origen              text DEFAULT 'manual' CHECK (origen IN ('manual','dragonfish_auto')),

    UNIQUE (local, fecha)
);

CREATE INDEX IF NOT EXISTS idx_vd_local_fecha ON ventas_diarias(local, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_vd_fecha       ON ventas_diarias(fecha DESC);

-- Trigger para mantener actualizado_at
CREATE OR REPLACE FUNCTION ventas_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vd_actualizar ON ventas_diarias;
CREATE TRIGGER trg_vd_actualizar
    BEFORE UPDATE ON ventas_diarias
    FOR EACH ROW
    EXECUTE FUNCTION ventas_actualizar_timestamp();

COMMENT ON TABLE ventas_diarias IS
'Venta del día por local. Reemplaza la planilla Excel de ventas. Fuente única para módulos Caja y Gastos.';

-- ═══════════════════════════════════════════════════════════════════════
-- Vista: campos calculados (shopping, total, acumulado mes)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW ventas_diarias_view AS
SELECT
    v.*,
    -- Shopping = lo cobrado físicamente en el local
    (v.efectivo + v.tarjeta + v.qr + v.vales) AS shopping,
    -- Total = shopping + venta online + factura oficina
    (v.efectivo + v.tarjeta + v.qr + v.vales + v.online + v.fc_oficina) AS total,
    -- Ticket promedio (solo si hubo transacciones)
    CASE WHEN v.cant_transacciones > 0
         THEN (v.efectivo + v.tarjeta + v.qr + v.vales) / v.cant_transacciones
         ELSE 0 END AS ticket_promedio
FROM ventas_diarias v;

GRANT SELECT ON ventas_diarias_view TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Tabla de jobs para Fase B (botón "Cargar desde Dragonfish")
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS dragonfish_jobs (
    id              bigserial PRIMARY KEY,
    local           text NOT NULL CHECK (local IN ('alcorta','unicenter','oficina')),
    fecha           date NOT NULL,
    estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_proceso','completado','error')),
    solicitado_por  text,
    solicitado_at   timestamptz DEFAULT now(),
    completado_at   timestamptz,
    error_msg       text,
    payload         jsonb              -- lo que devolvió el sync (opcional, para debug)
);

CREATE INDEX IF NOT EXISTS idx_df_jobs_pendientes
    ON dragonfish_jobs(local, estado)
    WHERE estado IN ('pendiente','en_proceso');

COMMENT ON TABLE dragonfish_jobs IS
'Cola asíncrona. La PWA inserta un job y el servicio Python local del local correspondiente lo ejecuta.';

-- ═══════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE ventas_diarias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dragonfish_jobs ENABLE ROW LEVEL SECURITY;

-- Helper: ¿es admin? (usuario con email = juanpsimonelli@gmail.com)
CREATE OR REPLACE FUNCTION ventas_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
          AND email = 'juanpsimonelli@gmail.com'
    );
$$;

-- Helper: el local del usuario (basado en su email — alcorta@..., unicenter@..., etc.)
CREATE OR REPLACE FUNCTION ventas_local_usuario() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT CASE
        WHEN u.email LIKE 'alcorta%'   THEN 'alcorta'
        WHEN u.email LIKE 'unicenter%' THEN 'unicenter'
        WHEN u.email LIKE 'oficina%'   THEN 'oficina'
        ELSE NULL
    END
    FROM auth.users u
    WHERE u.id = auth.uid();
$$;

-- POLITICAS ventas_diarias
DROP POLICY IF EXISTS vd_admin   ON ventas_diarias;
DROP POLICY IF EXISTS vd_gerente ON ventas_diarias;
DROP POLICY IF EXISTS vd_select  ON ventas_diarias;

CREATE POLICY vd_admin ON ventas_diarias FOR ALL
    USING (ventas_is_admin()) WITH CHECK (ventas_is_admin());

CREATE POLICY vd_gerente ON ventas_diarias FOR ALL
    USING (local = ventas_local_usuario())
    WITH CHECK (local = ventas_local_usuario());

GRANT SELECT, INSERT, UPDATE ON ventas_diarias TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE ventas_diarias_id_seq TO authenticated;

-- POLITICAS dragonfish_jobs
DROP POLICY IF EXISTS dj_admin    ON dragonfish_jobs;
DROP POLICY IF EXISTS dj_gerente  ON dragonfish_jobs;

CREATE POLICY dj_admin ON dragonfish_jobs FOR ALL
    USING (ventas_is_admin()) WITH CHECK (ventas_is_admin());

CREATE POLICY dj_gerente ON dragonfish_jobs FOR ALL
    USING (local = ventas_local_usuario())
    WITH CHECK (local = ventas_local_usuario());

GRANT SELECT, INSERT, UPDATE ON dragonfish_jobs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE dragonfish_jobs_id_seq TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
SELECT '✅ ventas-adorno 00_install.sql aplicado' AS status;
