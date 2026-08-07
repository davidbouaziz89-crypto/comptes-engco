// Marketing IA — relecture des chiffres réels des campagnes.
// David ne veut rien saisir à la main : cette fonction va chercher chez Meta la
// dépense, les impressions, les clics et les résultats, et met la ligne à jour.
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

// Meta renvoie les résultats sous forme d'actions typées ; on ne garde que celles
// qui ressemblent à un prospect, sinon le « coût par lead » ne veut rien dire.
const ACTIONS_LEAD = new Set([
  "lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.messaging_conversation_started_7d",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const companyId = body.company_id;
    if (!companyId) return json({ error: "Société manquante." }, 400);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, owner").eq("id", companyId).maybeSingle();
    if (!company || company.owner !== uid) return json({ error: "Accès refusé." }, 403);

    const { data: pub } = await admin.from("mkt_meta_ads")
      .select("user_token").eq("company_id", companyId).maybeSingle();
    if (!pub?.user_token) return json({ error: "Meta n'est pas connecté pour cette société." }, 400);

    const { data: campagnes } = await admin.from("mkt_ads")
      .select("id, external_campaign_id").eq("company_id", companyId)
      .not("external_campaign_id", "is", null);
    if (!campagnes?.length) return json({ ok: true, majs: 0, message: "Aucune campagne créée depuis l'app." });

    let majs = 0;
    const erreurs: string[] = [];
    for (const c of campagnes) {
      try {
        const champs = "spend,impressions,clicks,actions";
        const r = await fetch(`${GRAPH}/${c.external_campaign_id}/insights?fields=${champs}`
          + `&date_preset=maximum&access_token=${encodeURIComponent(pub.user_token)}`);
        const j = await r.json();
        if (j?.error) { erreurs.push(String(j.error.message).slice(0, 120)); continue; }
        const d = (j?.data || [])[0];

        // Pas encore de diffusion : on relit quand même le statut, c'est l'info utile.
        const st = await fetch(`${GRAPH}/${c.external_campaign_id}?fields=status,effective_status`
          + `&access_token=${encodeURIComponent(pub.user_token)}`);
        const stJson = await st.json();
        const brut = String(stJson?.effective_status || stJson?.status || "");
        const statut = brut === "ACTIVE" ? "active"
          : brut === "PAUSED" ? "en_pause"
          : (brut === "COMPLETED" || brut === "ARCHIVED" || brut === "DELETED") ? "terminee"
          : "en_pause";

        const leads = ((d?.actions || []) as { action_type: string; value: string }[])
          .filter((a) => ACTIONS_LEAD.has(a.action_type))
          .reduce((s, a) => s + Number(a.value || 0), 0);

        await admin.from("mkt_ads").update({
          depense: Number(d?.spend || 0),
          impressions: Number(d?.impressions || 0),
          clics: Number(d?.clicks || 0),
          leads,
          statut,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", c.id);
        majs++;
      } catch (e) {
        erreurs.push(String((e as Error)?.message || e).slice(0, 120));
      }
    }
    return json({ ok: true, majs, erreurs: erreurs.slice(0, 3) });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
