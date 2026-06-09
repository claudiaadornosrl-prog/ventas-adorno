-- ═══════════════════════════════════════════════════════════════════════
-- 03. CORRECCIONES MANUALES — Workflow vendedora → admin
-- ═══════════════════════════════════════════════════════════════════════
-- Vendedoras NO pueden modificar directamente las ventas (la fuente de verdad
-- es Dragonfish). Pero si detectan una anomalía, pueden solicitar una corrección
-- al admin (JP). El admin la aprueba o rechaza.
--
-- Excepción: columna fc_oficina sigue siendo editable libremente (todavía
-- no está conectada al sistema de la oficina).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas_correcciones (
    id              bigserial PRIMARY KEY,
    venta_id        bigint REFERENCES ventas_diarias(id) ON DELETE SET NULL,
    local           text NOT NULL CHECK (local IN ('alcorta','unicenter','oficina')),
    fecha           date NOT NULL,
    campo           text NOT NULL CHECK (campo IN (
        'efectivo','tarjeta','qr','vales','online','fc_oficina','cant_transacciones'
    )),
    valor_anterior  numeric(14,2),
    valor_propuesto numeric(14,2) NOT NULL,
    motivo          text NOT NULL,

    estado          text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','aprobada','rechazada')),

    solicitado_por  text NOT NULL,
    solicitado_at   timestamptz NOT NULL DEFAULT now(),

    resuelto_por    text,
    resuelto_at     timestamptz,
    comentario_admin text
);

CREATE INDEX IF NOT EXISTS idx_vc_local_fecha
    ON ventas_correcciones(local, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_vc_estado
    ON ventas_correcciones(estado, solicitado_at DESC);
CREATE INDEX IF NOT EXISTS idx_vc_venta
    ON ventas_correcciones(venta_id);

COMMENT ON TABLE ventas_correcciones IS
'Solicitudes y correcciones aplicadas a ventas_diarias. Las vendedoras solo pueden insertar (pedir corrección). Admin aprueba/rechaza.';

-- ═══════════════════════════════════════════════════════════════════════
-- Trigger: cuando admin APROBA una corrección, aplicar el cambio
-- a ventas_diarias automáticamente.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_ventas_aplicar_correccion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id bigint;
BEGIN
    -- Solo aplicar si estado pasó a 'aprobada'
    IF NEW.estado = 'aprobada' AND (OLD.estado IS NULL OR OLD.estado <> 'aprobada') THEN
        -- Encontrar el id de la venta (o crearla si no existe)
        SELECT id INTO v_id FROM ventas_diarias
        WHERE local = NEW.local AND fecha = NEW.fecha;

        IF v_id IS NULL THEN
            INSERT INTO ventas_diarias (local, fecha, cargado_por, origen)
            VALUES (NEW.local, NEW.fecha, NEW.resuelto_por, 'manual')
            RETURNING id INTO v_id;
        END IF;

        -- Actualizar el campo correspondiente
        EXECUTE format('UPDATE ventas_diarias SET %I = $1, actualizado_at = now() WHERE id = $2',
                       NEW.campo) USING NEW.valor_propuesto, v_id;

        -- Linkear la corrección con la venta
        NEW.venta_id := v_id;
        NEW.resuelto_at := COALESCE(NEW.resuelto_at, now());
    END IF;

    -- Si pasa a 'rechazada', solo registramos el momento
    IF NEW.estado = 'rechazada' AND (OLD.estado IS NULL OR OLD.estado <> 'rechazada') THEN
        NEW.resuelto_at := COALESCE(NEW.resuelto_at, now());
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vc_aplicar ON ventas_correcciones;
CREATE TRIGGER trg_vc_aplicar
    BEFORE UPDATE ON ventas_correcciones
    FOR EACH ROW
    EXECUTE FUNCTION trg_ventas_aplicar_correccion();

-- ═══════════════════════════════════════════════════════════════════════
-- RLS: vendedoras pueden INSERT y SELECT solo de su local. Admin ALL.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE ventas_correcciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vc_admin ON ventas_correcciones;
DROP POLICY IF EXISTS vc_select ON ventas_correcciones;
DROP POLICY IF EXISTS vc_insert ON ventas_correcciones;

-- Admin (JP): todo
CREATE POLICY vc_admin ON ventas_correcciones FOR ALL
    USING (ventas_is_admin())
    WITH CHECK (ventas_is_admin());

-- Cualquier autenticado puede SELECT (vendedoras ven solo su local vía vista o filtro client-side)
CREATE POLICY vc_select ON ventas_correcciones FOR SELECT USING (true);

-- Cualquier autenticado puede INSERT (con CHECK de local matchea su user)
CREATE POLICY vc_insert ON ventas_correcciones FOR INSERT
    WITH CHECK (
        ventas_is_admin()
        OR local = (
            SELECT CASE
                WHEN au.email = 'alcorta@claudiaadorno.com'        THEN 'alcorta'
                WHEN au.email = 'unicenter@claudiaadorno.com'      THEN 'unicenter'
                WHEN au.email = 'administracion@claudiaadorno.com' THEN 'oficina'
                ELSE NULL
            END
            FROM auth.users au WHERE au.id = auth.uid()
        )
    );

GRANT SELECT, INSERT ON ventas_correcciones TO authenticated;
GRANT UPDATE ON ventas_correcciones TO authenticated;  -- el CHECK del trigger filtra
GRANT USAGE, SELECT ON SEQUENCE ventas_correcciones_id_seq TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Vista helper: última corrección aprobada por (local, fecha, campo).
-- La PWA la usa para resaltar celdas corregidas y mostrar el motivo.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW ventas_correcciones_aplicadas AS
SELECT DISTINCT ON (local, fecha, campo)
    local, fecha, campo,
    valor_anterior, valor_propuesto,
    motivo, solicitado_por, resuelto_por, resuelto_at
FROM ventas_correcciones
WHERE estado = 'aprobada'
ORDER BY local, fecha, campo, resuelto_at DESC;

GRANT SELECT ON ventas_correcciones_aplicadas TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
SELECT '✅ 03_correcciones.sql aplicado' AS status;
