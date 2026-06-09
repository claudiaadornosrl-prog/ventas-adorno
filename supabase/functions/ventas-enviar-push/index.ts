// ════════════════════════════════════════════════════════════════════════
// Edge Function: ventas-enviar-push
// Envía Web Push notifications a las suscripciones registradas en
// ventas_push_subscriptions.
// Reusa los Supabase Secrets ya existentes: VAPID_PRIVATE_KEY, VAPID_SUBJECT
// (las mismas claves usadas por la edge function enviar-push de RRHH).
//
// Body acepta:
//   - { para_admins: true, title, body, url, tag }     ← manda a admins (juanpsimonelli@gmail.com)
//   - { user_email: '...@...', title, body, url, tag } ← manda a un usuario específico
// ════════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const ADMIN_EMAIL = "juanpsimonelli@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const vapidPublic  = Deno.env.get("VAPID_PUBLIC_KEY")  ?? "BJr3r3C_T-euS9kqRZX561MoMjHtMl2wpMfS8oUA17xv1TdlA6E3S_5VKyQO2kqlqngPHrQSGr-PpJutXdgKsKc";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:claudiaadornosrl@gmail.com";
    if (!vapidPrivate) {
      return new Response(JSON.stringify({ error: "Missing VAPID_PRIVATE_KEY secret" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { para_admins, user_email, title, body, url, tag } = await req.json();
    const targetEmail = para_admins ? ADMIN_EMAIL : user_email;
    if (!targetEmail) {
      return new Response(JSON.stringify({ error: "Falta para_admins o user_email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: subs, error } = await supa
      .from("ventas_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_email", targetEmail);
    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, msg: "sin suscripciones" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = JSON.stringify({
      title: title || "Ventas Adorno",
      body:  body || "",
      url:   url || "/",
      tag:   tag || "ventas-default",
    });

    let ok = 0, errores = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        }, payload);
        ok++;
        await supa.from("ventas_push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (e) {
        errores++;
        // 410 = endpoint expirado → borrar
        if ((e as any)?.statusCode === 410 || (e as any)?.statusCode === 404) {
          await supa.from("ventas_push_subscriptions").delete().eq("id", s.id);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: ok, fail: errores }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
