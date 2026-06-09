# Ventas — Claudia Adorno

Módulo de carga de ventas diarias. Reemplaza la planilla Excel
(`Ventas Alcorta 2026.xlsx`, etc.). Fuente única para futuros módulos
de **Caja** (movimientos de efectivo) y **Gastos** (prorrateo por venta).

## URL pública
- Producción: https://claudiaadornosrl-prog.github.io/ventas-adorno/

## Tablas Supabase
- `ventas_diarias` — registro diario por local
- `ventas_diarias_view` — vista con campos calculados (shopping, total, ticket prom.)
- `dragonfish_jobs` — cola asíncrona para Fase B

## Roles
- **Admin** (JP): ve los 3 locales, edita cualquiera
- **Local** (vendedora/encargada): solo su local

## Fases
- **Fase A** (✓ esta versión): carga manual + grilla mensual + admin consolidado
- **Fase B**: botón "Cargar desde Dragonfish" + servicio Python local
- **Fase C**: validación contra API Mercado Pago

## Deploy
```powershell
cd C:\CRM_Adorno\ventas-adorno
.\deploy.ps1 "mensaje"
```

## Setup inicial
1. Correr `sql/00_install.sql` en SQL Editor de Supabase
2. Crear repo `ventas-adorno` en organización GitHub `claudiaadornosrl-prog`
3. Activar GitHub Pages (branch: main, folder: /)
4. Verificar que los usuarios de auth.users existan:
   - `alcorta@adorno.com.ar`
   - `unicenter@adorno.com.ar`
   - `oficina@adorno.com.ar`
   - `juanpsimonelli@gmail.com` (admin)
