import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@proformationplus.fr";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey);

const ICON = "/icons/pv-192.png";
const APP_URL = "/photovoltaique.html";

// Heure de Paris (gère l'heure d'été automatiquement)
function parisNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((x) => x.type === t)!.value;
  let hh = parseInt(g("hour")); if (hh === 24) hh = 0;
  const mm = parseInt(g("minute"));
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: hh * 60 + mm };
}
const hhmmToMin = (s: string | null) => {
  if (!s) return null; const m = String(s).match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null;
};
const leadName = (l: { prenom?: string; nom?: string }) => [l.prenom, l.nom].filter(Boolean).join(" ").trim() || "Client";

async function sendToUser(userId: string, payload: Record<string, unknown>) {
  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}

Deno.serve(async (req: Request) => {
  // Authentification par secret (appel par cron / test manuel)
  const secret = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret") || "";
  if (!CRON_SECRET || secret !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const force = new URL(req.url).searchParams.get("force") === "1"; // test : ignore l'heure

  const { date, minutes } = parisNow();
  const report = { date, minutes, conf30: 0, com30: 0, recap: 0 };

  // ---- Rappels 30 min avant (fenêtre : RDV dans 0 à 35 min, non encore notifié) ----
  // Appel confirmateur
  {
    const { data: leads } = await admin.from("pv_leads")
      .select("id,nom,prenom,rdv_conf_heure,owner_confirmateur")
      .like("rdv_conf_date", date + "%").is("rdv_conf_notif", null).not("owner_confirmateur", "is", null);
    for (const l of leads || []) {
      const rm = hhmmToMin(l.rdv_conf_heure); if (rm == null) continue;
      const until = rm - minutes;
      if (until >= 0 && until <= 35) {
        await sendToUser(l.owner_confirmateur, { title: "📞 Appel client dans " + until + " min", body: leadName(l) + (l.rdv_conf_heure ? " — " + String(l.rdv_conf_heure).slice(0, 5) : ""), url: APP_URL, icon: ICON, tag: "conf-" + l.id });
        await admin.from("pv_leads").update({ rdv_conf_notif: new Date().toISOString() }).eq("id", l.id);
        report.conf30++;
      }
    }
  }
  // RDV commercial
  {
    const { data: leads } = await admin.from("pv_leads")
      .select("id,nom,prenom,ville,rdv_heure,owner_commercial")
      .like("rdv_date", date + "%").is("rdv_notif", null).not("owner_commercial", "is", null);
    for (const l of leads || []) {
      const rm = hhmmToMin(l.rdv_heure); if (rm == null) continue;
      const until = rm - minutes;
      if (until >= 0 && until <= 35) {
        await sendToUser(l.owner_commercial, { title: "📅 RDV dans " + until + " min", body: leadName(l) + (l.ville ? " · " + l.ville : "") + (l.rdv_heure ? " — " + String(l.rdv_heure).slice(0, 5) : ""), url: APP_URL, icon: ICON, tag: "com-" + l.id });
        await admin.from("pv_leads").update({ rdv_notif: new Date().toISOString() }).eq("id", l.id);
        report.com30++;
      }
    }
  }

  // ---- Récap du matin à 8h (Paris) : "tu as X RDV aujourd'hui" ----
  if (force || (minutes >= 480 && minutes < 485)) {
    const counts: Record<string, number> = {};
    const { data: c1 } = await admin.from("pv_leads").select("owner_confirmateur").like("rdv_conf_date", date + "%").not("owner_confirmateur", "is", null);
    for (const l of c1 || []) counts[l.owner_confirmateur] = (counts[l.owner_confirmateur] || 0) + 1;
    const { data: c2 } = await admin.from("pv_leads").select("owner_commercial").like("rdv_date", date + "%").not("owner_commercial", "is", null);
    for (const l of c2 || []) counts[l.owner_commercial] = (counts[l.owner_commercial] || 0) + 1;
    for (const [uid, n] of Object.entries(counts)) {
      await sendToUser(uid, { title: "☀️ Tes rendez-vous du jour", body: "Tu as " + n + " rendez-vous aujourd'hui." + (n > 0 ? " Bonne journée !" : ""), url: APP_URL, icon: ICON, tag: "recap-day" });
      report.recap++;
    }
  }

  return new Response(JSON.stringify(report), { headers: { "Content-Type": "application/json" } });
});
