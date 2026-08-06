// Chat : notifie en push web les autres membres (non mutés) d'une conversation.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:admin@proformationplus.fr",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

function nameFrom(email: string) {
  const n = (email || "").split("@")[0].replace(/[._\-+]+/g, " ").trim();
  return n ? n.replace(/\b\w/g, (c) => c.toUpperCase()) : email;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "Non authentifié" }, 401);

    const { conversation_id, message_id } = await req.json();
    if (!conversation_id || !message_id) return json({ error: "Paramètres manquants" }, 400);

    const { data: mem } = await admin.from("chat_members").select("user_id,muted").eq("conversation_id", conversation_id);
    if (!(mem || []).some((m: { user_id: string }) => m.user_id === u.user.id)) return json({ error: "forbidden" }, 403);

    const { data: msg } = await admin.from("chat_messages").select("body,sender_email").eq("id", message_id).single();
    const { data: conv } = await admin.from("chat_conversations").select("type,title").eq("id", conversation_id).single();
    const senderName = nameFrom(msg?.sender_email || "");
    const title = conv?.type === "group" ? (conv.title || "Groupe") : senderName;
    const bodyTxt = ((msg?.body || "").trim() || "📎 Pièce jointe").slice(0, 140);

    const targets = (mem || [])
      .filter((m: { user_id: string; muted: boolean }) => m.user_id !== u.user.id && !m.muted)
      .map((m: { user_id: string }) => m.user_id);

    let sent = 0, removed = 0;
    if (targets.length) {
      const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", targets);
      const payload = JSON.stringify({
        title,
        body: conv?.type === "group" ? `${senderName} : ${bodyTxt}` : bodyTxt,
        url: "/index.html?egcchat=" + conversation_id,
        icon: "/icons/portal-192.png",
        badge: "/icons/portal-192.png",
        tag: "chat-" + conversation_id,
      });
      for (const s of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("id", s.id); removed++; }
        }
      }
    }
    return json({ ok: true, targets: targets.length, sent, removed });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
