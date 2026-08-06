// Marketing IA — pilote automatique.
// Appelé par pg_cron. Deux missions :
//   1) chaque lundi matin, faire écrire la semaine par les agents ;
//   2) prévenir David sur son téléphone : « X posts prêts à valider ».
// Il prévient aussi le jour où un post validé doit partir, tant que la
// publication automatique n'est pas en place.
//
// Secrets requis : CRON_SECRET, VAPID_*, ANTHROPIC_API_KEY (via mkt-generate).
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

const ICON = "/icons/marketing-192.png";
const APP_URL = "/marketing.html";

async function sendToUser(userId: string, payload: Record<string, unknown>) {
  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}

// Lundi de la semaine en cours (UTC, 00:00).
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return x;
}
const parisDay = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());

Deno.serve(async (req: Request) => {
  const given = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret") || "";
  if (!CRON_SECRET || given !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const force = new URL(req.url).searchParams.get("force") === "1";

  const report = { generated: 0, companies: 0, notified: 0, reminded: 0, errors: [] as string[] };

  // ---------- 1) Écriture automatique de la semaine ----------
  const monday = mondayOf(new Date());
  const sunday = new Date(monday.getTime() + 7 * 86400000);

  const { data: companies } = await admin.from("mkt_companies")
    .select("id, name, owner, auto_weekly").eq("auto_weekly", true);

  const perOwner: Record<string, { count: number; names: string[] }> = {};

  for (const c of companies || []) {
    try {
      // Une cadence active est indispensable, sinon il n'y a rien à écrire.
      const { data: cad } = await admin.from("mkt_cadence")
        .select("per_week").eq("company_id", c.id).eq("active", true);
      const total = (cad || []).reduce((s: number, r: { per_week: number }) => s + (r.per_week || 0), 0);
      if (!total) continue;

      // Déjà écrite ? On ne double pas la semaine.
      const { count } = await admin.from("mkt_posts")
        .select("id", { count: "exact", head: true })
        .eq("company_id", c.id)
        .gte("scheduled_at", monday.toISOString())
        .lt("scheduled_at", sunday.toISOString());
      if ((count || 0) > 0 && !force) continue;

      const res = await fetch(`${url}/functions/v1/mkt-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
        body: JSON.stringify({ company_id: c.id, owner_id: c.owner }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) { report.errors.push(`${c.name} : ${out.error || res.status}`); continue; }

      const n = (out.created || []).length;
      report.generated += n;
      report.companies++;
      if (!perOwner[c.owner]) perOwner[c.owner] = { count: 0, names: [] };
      perOwner[c.owner].count += n;
      perOwner[c.owner].names.push(c.name);
    } catch (e) {
      report.errors.push(`${c.name} : ${String((e as Error)?.message || e)}`);
    }
  }

  for (const [owner, info] of Object.entries(perOwner)) {
    report.notified += await sendToUser(owner, {
      title: "Ta semaine est écrite ✍️",
      body: `${info.count} post(s) prêts à valider — ${info.names.join(", ")}`,
      icon: ICON, url: APP_URL, tag: "mkt-week",
    });
  }

  // ---------- 2) Rappel : des posts partent aujourd'hui mais ne sont pas validés ----------
  const today = parisDay();
  const { data: due } = await admin.from("mkt_posts")
    .select("id, company_id, status, scheduled_at")
    .eq("status", "a_valider")
    .gte("scheduled_at", today + "T00:00:00Z")
    .lt("scheduled_at", today + "T23:59:59Z");

  if ((due || []).length) {
    const byOwner: Record<string, number> = {};
    for (const p of due || []) {
      const { data: co } = await admin.from("mkt_companies").select("owner").eq("id", p.company_id).maybeSingle();
      if (co?.owner) byOwner[co.owner] = (byOwner[co.owner] || 0) + 1;
    }
    for (const [owner, n] of Object.entries(byOwner)) {
      report.reminded += await sendToUser(owner, {
        title: "Des posts attendent ton feu vert ⏳",
        body: `${n} post(s) prévus aujourd'hui ne sont pas encore validés.`,
        icon: ICON, url: APP_URL, tag: "mkt-due",
      });
    }
  }

  return new Response(JSON.stringify(report), { headers: { "Content-Type": "application/json" } });
});
