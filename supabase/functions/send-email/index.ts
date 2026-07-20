// Edge function partagée « send-email » — envoi d'emails transactionnels via Resend.
// Déployée sur Supabase (unified-backend). Appelable par le portail et tous les CRM.
// Secret requis : RESEND_API_KEY (Supabase > Edge Functions > Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Adresse d'expéditeur par défaut (domaine vérifié dans Resend : leadscall-ia.com).
// Le nom affiché « ProFormationPlus » est ce que voit le destinataire ; modifiable par appel via body.from.
const DEFAULT_FROM = "ProFormationPlus <noreply@leadscall-ia.com>";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY manquante (secret Supabase)" }, 500);
    const admin = createClient(url, serviceKey);

    // L'appelant doit être un utilisateur connecté ayant au moins un accès projet (anti-spam).
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const { data: mems } = await admin.from("app_memberships").select("role").eq("user_id", userData.user.id);
    if (!mems || !mems.length) return json({ error: "Accès refusé" }, 403);

    const body = await req.json();
    const to = body.to;
    const subject = (body.subject || "").toString();
    const html = body.html ? body.html.toString() : undefined;
    const text = body.text ? body.text.toString() : undefined;
    if (!to || !subject || (!html && !text)) {
      return json({ error: "Champs requis : to, subject, et html (ou text)" }, 400);
    }

    const payload: Record<string, unknown> = { from: body.from || DEFAULT_FROM, to, subject };
    if (html) payload.html = html;
    if (text) payload.text = text;
    if (body.reply_to) payload.reply_to = body.reply_to;
    if (body.cc) payload.cc = body.cc;
    if (body.bcc) payload.bcc = body.bcc;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: out?.message || "Échec de l'envoi", details: out }, r.status);
    return json({ ok: true, id: out?.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
