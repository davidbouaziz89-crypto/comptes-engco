// Marketing IA — création d'une campagne publicitaire à partir d'un post déjà publié.
//
// Principe de sécurité : tout est créé EN PAUSE. Rien ne dépense un centime tant que
// David n'a pas activé la campagne lui-même dans le Gestionnaire de publicités.
// Un bug ici coûterait de l'argent réel ; la pause est la garde-fou.
//
// Chaîne Meta : campagne → ensemble de publicités (budget, ciblage, durée)
//               → création (le post existant) → publicité.
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

async function poster(chemin: string, form: Record<string, string>) {
  const res = await fetch(`${GRAPH}/${chemin}`, { method: "POST", body: new URLSearchParams(form) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const e = data?.error || {};
    throw new Error([e.error_user_title, e.error_user_msg || e.message].filter(Boolean).join(" — ")
      || `Meta a refusé (HTTP ${res.status})`);
  }
  return data;
}

// Objectif choisi par David → réglages Meta cohérents.
// On reste sur des couples objectif/optimisation qui ne réclament pas d'objet
// promu supplémentaire (pixel, formulaire) : ils marcheraient à moitié sinon.
const OBJECTIFS: Record<string, { objective: string; optimization_goal: string; billing_event: string }> = {
  notoriete: { objective: "OUTCOME_AWARENESS", optimization_goal: "REACH", billing_event: "IMPRESSIONS" },
  trafic: { objective: "OUTCOME_TRAFFIC", optimization_goal: "LINK_CLICKS", billing_event: "IMPRESSIONS" },
  messages: { objective: "OUTCOME_ENGAGEMENT", optimization_goal: "POST_ENGAGEMENT", billing_event: "IMPRESSIONS" },
  leads: { objective: "OUTCOME_ENGAGEMENT", optimization_goal: "POST_ENGAGEMENT", billing_event: "IMPRESSIONS" },
  ventes: { objective: "OUTCOME_ENGAGEMENT", optimization_goal: "POST_ENGAGEMENT", billing_event: "IMPRESSIONS" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const postId = body.post_id;
    const budgetJour = Number(body.budget_jour || 0);
    const jours = Math.max(1, Math.min(90, Number(body.jours || 7)));
    const objectif = String(body.objectif || "leads");
    const pays = (Array.isArray(body.pays) && body.pays.length ? body.pays : ["FR"]) as string[];
    const ageMin = Math.max(18, Number(body.age_min || 25));
    const ageMax = Math.min(65, Number(body.age_max || 65));

    if (!postId) return json({ error: "Post manquant." }, 400);
    if (budgetJour < 1) return json({ error: "Le budget quotidien doit être d'au moins 1 €." }, 400);

    const { data: post } = await admin.from("mkt_posts")
      .select("id, company_id, network, body, external_id, published_at").eq("id", postId).maybeSingle();
    if (!post) return json({ error: "Post introuvable." }, 404);
    if (!post.published_at || !post.external_id) {
      return json({ error: "Ce post n'est pas encore publié : on ne peut sponsoriser qu'une publication en ligne." }, 400);
    }
    if (post.network !== "facebook") {
      return json({ error: "Pour l'instant seuls les posts Facebook peuvent être sponsorisés depuis l'app." }, 400);
    }

    const { data: company } = await admin.from("mkt_companies")
      .select("id, owner, name").eq("id", post.company_id).maybeSingle();
    if (!company || company.owner !== uid) return json({ error: "Accès refusé." }, 403);

    const { data: pub } = await admin.from("mkt_meta_ads")
      .select("ad_account_id, user_token").eq("company_id", post.company_id).maybeSingle();
    if (!pub?.ad_account_id || !pub.user_token) {
      return json({ error: "Aucun compte publicitaire connecté pour cette société. Reconnecte Meta dans Paramétrage." }, 400);
    }
    const act = `act_${pub.ad_account_id}`;
    const token = pub.user_token;
    const reglages = OBJECTIFS[objectif] || OBJECTIFS.leads;
    const nom = `${company.name} — ${(post.body || "").slice(0, 40).replace(/\s+/g, " ").trim()}`;

    // 1) Campagne, en pause.
    const camp = await poster(`${act}/campaigns`, {
      name: nom,
      objective: reglages.objective,
      status: "PAUSED",
      special_ad_categories: "[]",
      access_token: token,
    });

    const debut = new Date(Date.now() + 10 * 60 * 1000);          // dans 10 min
    const fin = new Date(debut.getTime() + jours * 86400 * 1000);

    // 2) Ensemble de publicités : budget, ciblage, durée.
    const adset = await poster(`${act}/adsets`, {
      name: `${nom} — ciblage`,
      campaign_id: String(camp.id),
      daily_budget: String(Math.round(budgetJour * 100)),          // Meta compte en centimes
      billing_event: reglages.billing_event,
      optimization_goal: reglages.optimization_goal,
      start_time: debut.toISOString(),
      end_time: fin.toISOString(),
      targeting: JSON.stringify({
        geo_locations: { countries: pays },
        age_min: ageMin, age_max: ageMax,
      }),
      status: "PAUSED",
      access_token: token,
    });

    // 3) La création reprend le post existant : mêmes texte et visuel qu'en organique.
    const creative = await poster(`${act}/adcreatives`, {
      name: `${nom} — visuel`,
      object_story_id: String(post.external_id),
      access_token: token,
    });

    // 4) La publicité elle-même.
    const ad = await poster(`${act}/ads`, {
      name: nom,
      adset_id: String(adset.id),
      creative: JSON.stringify({ creative_id: String(creative.id) }),
      status: "PAUSED",
      access_token: token,
    });

    const { data: ligne, error: insErr } = await admin.from("mkt_ads").insert({
      company_id: post.company_id, post_id: post.id, network: "facebook",
      nom, objectif, budget: budgetJour * jours, depense: 0,
      started_at: debut.toISOString().slice(0, 10),
      ended_at: fin.toISOString().slice(0, 10),
      statut: "en_pause",
      external_campaign_id: String(camp.id),
      external_adset_id: String(adset.id),
      external_ad_id: String(ad.id),
      notes: "Créée depuis Marketing IA. À activer dans le Gestionnaire de publicités.",
    }).select("id").single();
    if (insErr) return json({ error: "Campagne créée chez Meta mais non enregistrée : " + insErr.message }, 500);

    return json({
      ok: true, id: ligne.id, campaign_id: camp.id,
      url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${pub.ad_account_id}&selected_campaign_ids=${camp.id}`,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
