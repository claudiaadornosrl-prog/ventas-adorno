// ═══════════════════════════════════════════════════════════════════════
//  Edge Function: mp-webhook
//  Recibe notificaciones de pago de Mercado Pago EN TIEMPO REAL.
//
//  Motivo: el endpoint /v1/payments/search de MP tiene lag de indexación
//  de horas (o pierde pagos directamente) — verificado el 26-jul-2026 con
//  el pago 169766660937 que nunca apareció en el search pero sí en el GET
//  directo. Todo el pipeline de polling es poco confiable.
//
//  Flujo:
//    1. MP manda POST acá cuando se crea/actualiza un pago.
//       Formato: { "type": "payment", "data": { "id": "123456789" } }
//       (también soporta el formato viejo: ?topic=payment&id=123456789)
//    2. Consultamos GET /v1/payments/{id} (tiempo real, confiable).
//    3. Si está approved y es de un local conocido → upsert en
//       tesoreria_movimientos con el MISMO formato que scraper_mp.py
//       (hash mp_pay_{id} → sin duplicados con el scraper horario).
//
//  Config en el panel MP (developers → app → Webhooks):
//    URL: https://kwwiykssrpabncpqtmwi.supabase.co/functions/v1/mp-webhook
//    Eventos: Pagos (payment)
//
//  Secrets requeridos:
//    MP_LOCALES_TOKEN   (ya está — el mismo del scraper)
//
//  IMPORTANTE: deployar con verify_jwt=false (MP no manda JWT de Supabase).
//  La seguridad la da: (a) solo procesamos IDs que MP nos manda y validamos
//  contra la API de MP con nuestro token — un atacante no puede inyectar
//  pagos falsos porque el GET a MP es la fuente de verdad.
// ═══════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const STORE_A_LOCAL: Record<string, string> = {
  "31102301": "unicenter",
  "31101996": "alcorta",
};
const POS_NAMES: Record<string, string> = {
  "6678833": "Unicenter1",
  "6679781": "Unicenter2",
  "6830086": "Alcorta2",
  "6830219": "Alcora1",
};

function canalDe(pt: string): string {
  pt = (pt || "").toLowerCase();
  if (pt === "account_money") return "qr";
  if (["credit_card", "debit_card", "prepaid_card"].includes(pt)) return "point";
  if (pt === "bank_transfer") return "bank_transfer";
  return pt || "otro";
}

// deno-lint-ignore no-explicit-any
function paymentAMovimiento(p: any, cuentaId: number) {
  const fecha = (p.date_approved || p.date_created || "").split("T")[0];
  const bruto = +(p.transaction_amount || 0);
  const fees = p.fee_details || [];
  // deno-lint-ignore no-explicit-any
  const comisionTotal = fees.reduce((s: number, f: any) => s + (+f.amount || 0), 0);
  const storeId = String(p.store_id || "");
  const posId = String(p.pos_id || "");
  const local = STORE_A_LOCAL[storeId] || null;
  const posName = POS_NAMES[posId] || "";
  const canal = canalDe(p.payment_type_id);
  const head: string[] = [];
  if (local) head.push(local.toUpperCase());
  if (canal) head.push(canal.toUpperCase());
  if (posName) head.push(posName);
  const tail: string[] = [];
  if (p.payment_method_id) tail.push(p.payment_method_id);
  if (p.external_reference) tail.push(`ref=${p.external_reference}`);
  const desc = (head.join(" · ") + (head.length && tail.length ? " | " : "") + tail.join(" · ")).slice(0, 500);
  return {
    cuenta_id: cuentaId,
    fecha,
    importe: String(bruto),
    descripcion: desc,
    local,
    canal,
    origen: "scraper_mp",  // mismo origen para que la PWA lo trate igual
    controlado: false,
    hash_externo: `mp_pay_${p.id}`,
    numero_comprobante: String(p.id || ""),
    extra: {
      status: p.status,
      status_detail: p.status_detail,
      payment_method_id: p.payment_method_id,
      payment_type_id: p.payment_type_id,
      canal,
      local,
      pos_id: p.pos_id,
      pos_name: posName,
      store_id: p.store_id,
      comision_total: comisionTotal,
      net_received_amount: p.transaction_details?.net_received_amount,
      fees,
      external_reference: p.external_reference,
      payer_email: p.payer?.email,
      money_release_date: p.money_release_date ? String(p.money_release_date).split("T")[0] : null,
      date_approved: p.date_approved || p.date_created,
      via_webhook: true,
    },
    cargado_por: "mp_webhook",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Extraer el payment ID de la notificación (2 formatos posibles) ──
    let paymentId: string | null = null;
    const url = new URL(req.url);

    // Formato viejo (IPN): ?topic=payment&id=123456
    const topic = url.searchParams.get("topic") || url.searchParams.get("type");
    const qId = url.searchParams.get("id") || url.searchParams.get("data.id");
    if (topic === "payment" && qId) paymentId = qId;

    // Formato nuevo (Webhooks): body JSON { type: "payment", data: { id } }
    if (!paymentId && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (body?.type === "payment" && body?.data?.id) paymentId = String(body.data.id);
      // merchant_order y otros topics se ignoran silenciosamente
    }

    if (!paymentId) {
      // Notificación de otro tipo (merchant_order, chargeback, etc.) — OK 200 para que MP no reintente
      return new Response(JSON.stringify({ ok: true, skipped: "no payment id" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Consultar el pago por GET directo (tiempo real, confiable) ──
    const token = Deno.env.get("MP_LOCALES_TOKEN");
    if (!token) throw new Error("Falta MP_LOCALES_TOKEN");

    const payResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!payResp.ok) {
      // Pago de otra cuenta o inexistente — 200 para no generar reintentos infinitos
      return new Response(JSON.stringify({ ok: true, skipped: `GET payment ${payResp.status}` }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const payment = await payResp.json();

    // Solo pagos aprobados de locales conocidos
    if (payment.status !== "approved") {
      return new Response(JSON.stringify({ ok: true, skipped: `status=${payment.status}` }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Upsert en tesoreria_movimientos ──
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cuenta } = await sb.from("tesoreria_cuentas")
      .select("id").eq("nombre", "MP Locales").eq("tipo", "mp").limit(1).single();
    if (!cuenta) throw new Error("No se encontró la cuenta MP Locales");

    const mov = paymentAMovimiento(payment, cuenta.id);

    // Insertar solo si no existe (el scraper horario puede haberlo traído ya)
    const { data: existe } = await sb.from("tesoreria_movimientos")
      .select("id").eq("hash_externo", mov.hash_externo).limit(1);
    if (existe && existe.length > 0) {
      return new Response(JSON.stringify({ ok: true, ya_existia: true, payment_id: paymentId }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { error: insErr } = await sb.from("tesoreria_movimientos").insert(mov);
    if (insErr) throw new Error(`Insert: ${insErr.message}`);

    return new Response(JSON.stringify({
      ok: true, insertado: true, payment_id: paymentId,
      importe: mov.importe, local: mov.local,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e) {
    // 200 igual — si devolvemos 500, MP reintenta indefinidamente
    console.error("[mp-webhook]", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
