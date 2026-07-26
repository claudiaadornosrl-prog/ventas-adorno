// ═══════════════════════════════════════════════════════════════════════
//  Edge Function: sync-mp-live
//  Trae los pagos de MP del día EN VIVO (API oficial) y los upsertea en
//  tesoreria_movimientos ANTES de cerrar un turno de ventas.
//
//  Motivo: el sync horario (scraper_mp.py) deja una ventana de hasta 60min
//  sin pagos → el arqueo automático del cierre de turno daba diferencias
//  "fantasma". Con esta función, el cierre siempre cruza contra datos frescos.
//
//  Payload: { local: "alcorta" | "unicenter", fecha?: "YYYY-MM-DD" }
//  Respuesta: { ok: true, pagos_api: N, nuevos: N, ya_estaban: N }
//
//  Secrets requeridos (Supabase Dashboard → Edge Functions → Secrets):
//    MP_LOCALES_TOKEN = APP_USR-...   (el mismo del scraper)
//
//  El upsert usa hash_externo = "mp_pay_{id}" → idéntico al scraper Python,
//  así el sync horario posterior NO duplica (ON CONFLICT merge).
// ═══════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mapeos de stores y POS — mantener en sync con scraper_mp.py
const STORE_A_LOCAL: Record<number, string> = {
  31102301: "unicenter",
  31101996: "alcorta",
};
const POS_NAMES: Record<number, string> = {
  6678833: "Unicenter1",
  6679781: "Unicenter2",
  6830086: "Alcorta2",
  6830219: "Alcora1",
};

function toInt(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

function localYCanal(p: Record<string, unknown>) {
  const storeId = toInt(p.store_id);
  const posId = toInt(p.pos_id);
  const pt = String(p.payment_type_id || "").toLowerCase();
  const local = STORE_A_LOCAL[storeId] || "";
  const posName = POS_NAMES[posId] || "";
  let canal: string;
  if (pt === "account_money") canal = "qr";
  else if (["credit_card", "debit_card", "prepaid_card"].includes(pt)) canal = "point";
  else canal = pt || "otro";
  return { local, posName, canal };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Solo POST" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const { local, fecha } = await req.json();
    if (!local || !["alcorta", "unicenter"].includes(local)) {
      return new Response(JSON.stringify({ ok: false, error: 'local debe ser "alcorta" o "unicenter"' }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const token = Deno.env.get("MP_LOCALES_TOKEN");
    if (!token) throw new Error("Falta MP_LOCALES_TOKEN en los Secrets");

    // Fecha del día (default hoy, hora argentina)
    const hoyArg = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    const dia = fecha || hoyArg;

    // Rango del día completo en hora argentina (UTC-3)
    const beginDate = `${dia}T00:00:00.000-03:00`;
    const endDate = `${dia}T23:59:59.999-03:00`;

    // ── Consultar pagos del día a la API MP (paginado) ──
    const pagos: Record<string, unknown>[] = [];
    let offset = 0;
    const PAGE = 50;
    for (let i = 0; i < 10; i++) {  // máx 500 pagos por día (sobra)
      const params = new URLSearchParams({
        begin_date: beginDate,
        end_date: endDate,
        range: "date_approved",
        sort: "date_approved",
        criteria: "desc",
        status: "approved",
        limit: String(PAGE),
        offset: String(offset),
      });
      const resp = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`API MP ${resp.status}: ${txt.slice(0, 200)}`);
      }
      const data = await resp.json();
      const results = data.results || [];
      pagos.push(...results);
      if (results.length < PAGE) break;
      offset += results.length;
    }

    // ── Filtrar solo pagos del local pedido ──
    const pagosLocal = pagos.filter((p) => localYCanal(p).local === local);

    // ── Mapear a tesoreria_movimientos (mismo formato que scraper_mp.py) ──
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // cuenta_id de MP Locales
    const { data: cuenta } = await sb.from("tesoreria_cuentas")
      .select("id").eq("nombre", "MP Locales").eq("tipo", "mp").limit(1).single();
    if (!cuenta) throw new Error("No se encontró la cuenta MP Locales en tesoreria_cuentas");

    const movs = pagosLocal.map((p) => {
      const enr = localYCanal(p);
      const fees = (p.fee_details as Array<Record<string, unknown>>) || [];
      const comisionTotal = fees.reduce((s, f) => s + (parseFloat(String(f.amount || 0)) || 0), 0);
      const fechaAprob = String(p.date_approved || p.date_created || "");
      const fechaMov = fechaAprob ? fechaAprob.split("T")[0] : dia;
      const pm = String(p.payment_method_id || "");
      const pt = String(p.payment_type_id || "");

      const descHead = [enr.local?.toUpperCase(), enr.canal?.toUpperCase(), enr.posName].filter(Boolean).join(" · ");
      const descTail = [pm, p.external_reference ? `ref=${p.external_reference}` : ""].filter(Boolean).join(" · ");
      const descripcion = (descHead && descTail ? `${descHead} | ${descTail}` : descHead || descTail).slice(0, 500);

      return {
        cuenta_id: cuenta.id,
        fecha: fechaMov,
        importe: String(p.transaction_amount || 0),
        descripcion,
        local: enr.local || null,
        canal: enr.canal,
        origen: "sync_mp_live",
        controlado: false,
        hash_externo: `mp_pay_${p.id}`,
        numero_comprobante: String(p.id || ""),
        extra: {
          status: p.status,
          status_detail: p.status_detail,
          payment_method_id: pm,
          payment_type_id: pt,
          canal: enr.canal,
          local: enr.local,
          pos_id: p.pos_id,
          pos_name: enr.posName,
          store_id: p.store_id,
          comision_total: comisionTotal,
          net_received_amount: (p.transaction_details as Record<string, unknown>)?.net_received_amount,
          fees,
          external_reference: p.external_reference,
          payer_email: (p.payer as Record<string, unknown>)?.email,
          money_release_date: p.money_release_date ? String(p.money_release_date).split("T")[0] : null,
          date_approved: p.date_approved || p.date_created,
        },
        cargado_por: "sync_mp_live",
      };
    });

    // ── Upsert: los que ya existen (hash del scraper) NO se pisan ──
    // Estrategia: consultar hashes existentes, insertar solo los nuevos.
    let nuevos = 0;
    if (movs.length > 0) {
      const hashes = movs.map((m) => m.hash_externo);
      const { data: existentes } = await sb.from("tesoreria_movimientos")
        .select("hash_externo").in("hash_externo", hashes);
      const setExist = new Set((existentes || []).map((e) => e.hash_externo));
      const aInsertar = movs.filter((m) => !setExist.has(m.hash_externo));
      if (aInsertar.length > 0) {
        const { error: insErr } = await sb.from("tesoreria_movimientos").insert(aInsertar);
        if (insErr) throw new Error(`Insert movs: ${insErr.message}`);
        nuevos = aInsertar.length;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      local: local,
      fecha: dia,
      pagos_api: pagosLocal.length,
      nuevos,
      ya_estaban: pagosLocal.length - nuevos,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
