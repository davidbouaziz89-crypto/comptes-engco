import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@proformationplus.fr";
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "test";

    // Cibles = liste d'user_id
    let targets: string[] = [];
    if (action === "test") {
      targets = [userData.user.id];
    } else if (action === "send") {
      const { data: mems } = await admin.from("app_memberships").select("role").eq("user_id", userData.user.id);
      const isAdmin = (mems || []).some((m: { role: string }) => m.role === "admin");
      if (!isAdmin) return json({ error: "Réservé à l'administrateur" }, 403);
      targets = Array.isArray(body.user_ids) ? body.user_ids : [];
      if (!targets.length) return json({ error: "Aucun destinataire" }, 400);
    } else {
      return json({ error: "Action inconnue" }, 400);
    }

    const payload = JSON.stringify({
      title: body.title || "ProFormationPlus",
      body: body.body || "Ceci est une notification de test ✅",
      url: body.url || "/",
      icon: body.icon || "/icons/portal-192.png",
      badge: body.badge || "/icons/portal-192.png",
      tag: body.tag || undefined,
    });

    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", targets);
    let sent = 0, removed = 0;
    const errors: string[] = [];
    for (const s of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
          removed++;
        } else {
          errors.push(String((e as Error)?.message || e));
        }
      }
    }
    return json({ ok: true, subscriptions: (subs || []).length, sent, removed, errors });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
