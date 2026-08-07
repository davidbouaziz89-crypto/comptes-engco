// Marketing IA — piloter une campagne sans quitter l'app.
// Activer, mettre en pause, arrêter, changer le budget quotidien.
//
// Une activation engage de l'argent réel : elle est donc explicite côté app
// (confirmation) et tracée ici (statut remis à jour en base dans la foulée).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const GRAPH = "https://graph.facebook.com/v21.0";

async function poster(id: string, form: Record<string, string>) {
  const res = await fetch(`${GRAPH}/${id}`, { method: "POST", body: new URLSearchParams(form) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const e = data?.error || {};
    throw new Error([e.error_user_title, e.error_user_msg || e.message].filter(Boolean).join(" — ")
      || `Meta a refusé (HTTP ${res.status})`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { ad_id: adId, action, budget_jour: budgetJour } = body;
    if (!adId || !action) return json({ error: "Paramètres manquants." }, 400);

    const { data: camp } = await admin.from("mkt_ads")
      .select("id, company_id, external_campaign_id, external_adset_id, budget").eq("id", adId).maybeSingle();
    if (!camp) return json({ error: "Campagne introuvable." }, 404);
    if (!camp.external_campaign_id) {
      return json({ error: "Cette campagne a été saisie à la main : elle n'existe pas chez Meta, on ne peut pas la piloter." }, 400);
    }

    const { data: company } = await admin.from("mkt_companies")
      .select("id, owner").eq("id", camp.company_id).maybeSingle();
    if (!company || company.owner !== uid) return json({ error: "Accès refusé." }, 403);

    const { data: pub } = await admin.from("mkt_meta_ads")
      .select("user_token").eq("company_id", camp.company_id).maybeSingle();
    if (!pub?.user_token) return json({ error: "Meta n'est pas connecté pour cette société." }, 400);
    const token = pub.user_token;

    if (action === "budget") {
      const b = Number(budgetJour || 0);
      if (b < 1) return json({ error: "Budget quotidien minimum : 1 €." }, 400);
      if (!camp.external_adset_id) return json({ error: "Ensemble de publicités inconnu." }, 400);
      await poster(camp.external_adset_id, { daily_budget: String(Math.round(b * 100)), access_token: token });
      await admin.from("mkt_ads").update({ updated_at: new Date().toISOString() }).eq("id", adId);
      return json({ ok: true, budget_jour: b });
    }

    const cible: Record<string, { meta: string; local: string }> = {
      activer: { meta: "ACTIVE", local: "active" },
      pause: { meta: "PAUSED", local: "en_pause" },
      terminer: { meta: "ARCHIVED", local: "terminee" },
    };
    const c = cible[action];
    if (!c) return json({ error: "Action inconnue." }, 400);

    // La campagne ET son ensemble doivent être dans le même état, sinon Meta
    // affiche « active » sans rien diffuser — le piège classique.
    await poster(camp.external_campaign_id, { status: c.meta, access_token: token });
    if (camp.external_adset_id) {
      try { await poster(camp.external_adset_id, { status: c.meta, access_token: token }); } catch (_) { /* non bloquant */ }
    }

    await admin.from("mkt_ads").update({ statut: c.local, updated_at: new Date().toISOString() }).eq("id", adId);
    return json({ ok: true, statut: c.local });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
