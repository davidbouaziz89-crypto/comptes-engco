// Marketing IA — connexion d'une Page LinkedIn.
// L'app ouvre l'écran d'autorisation LinkedIn ; au retour, elle transmet ici le
// code reçu. Cette fonction l'échange contre un jeton, liste les Pages que David
// administre, et enregistre celle qui correspond à la société.
//
// Secrets requis : LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const API = "https://api.linkedin.com";
const VERSION = "202405";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const clientId = Deno.env.get("LINKEDIN_CLIENT_ID");
    const clientSecret = Deno.env.get("LINKEDIN_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return json({ error: "Identifiants LinkedIn manquants : ajoute LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET dans les secrets Supabase." }, 500);
    }

    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { company_id: companyId, code, redirect_uri: redirectUri, org_id: orgChoisi } = body;
    if (!companyId || !code || !redirectUri) return json({ error: "Paramètres manquants." }, 400);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, owner, name").eq("id", companyId).maybeSingle();
    if (!company || company.owner !== uid) return json({ error: "Accès refusé." }, 403);

    // 1) Code → jeton d'accès (valable 60 jours)
    const tk = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code,
        redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret,
      }),
    });
    const tkJson = await tk.json().catch(() => ({}));
    if (!tk.ok || !tkJson.access_token) {
      return json({ error: "LinkedIn a refusé le code : " + String(tkJson?.error_description || tkJson?.error || tk.status).slice(0, 200) }, 400);
    }
    const token = tkJson.access_token as string;
    const expire = tkJson.expires_in
      ? new Date(Date.now() + Number(tkJson.expires_in) * 1000).toISOString()
      : null;

    const entetes = {
      "Authorization": `Bearer ${token}`,
      "LinkedIn-Version": VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    };

    // 2) Les Pages dont David est administrateur
    const acl = await fetch(
      `${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(id,localizedName)))`,
      { headers: entetes },
    );
    const aclJson = await acl.json().catch(() => ({}));
    if (!acl.ok) {
      return json({ error: "Lecture des Pages impossible : " + String(aclJson?.message || acl.status).slice(0, 200) }, 400);
    }
    type Elt = { "organization~"?: { id?: number; localizedName?: string }; organization?: string };
    const pages = ((aclJson?.elements || []) as Elt[]).map((e) => {
      const urn = String(e.organization || "");
      const id = e["organization~"]?.id ?? Number(urn.split(":").pop());
      return { id: String(id), name: e["organization~"]?.localizedName || urn };
    }).filter((p) => p.id && p.id !== "NaN");

    if (!pages.length) {
      return json({ error: "Aucune Page LinkedIn administrée par ce compte. Vérifie que tu es bien administrateur de la Page." }, 400);
    }

    // Reconnaissance par le nom de la société, comme pour Meta.
    let page = orgChoisi ? pages.find((p) => p.id === String(orgChoisi)) : undefined;
    if (!page) {
      const nom = String(company.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      page = pages.find((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(nom))
        || (pages.length === 1 ? pages[0] : undefined);
    }
    if (!page) {
      return json({
        ok: true, need_choice: true, pages,
        message: "Plusieurs Pages disponibles : dis-moi laquelle rattacher à cette société.",
      });
    }

    const { error: upErr } = await admin.from("mkt_social").upsert({
      company_id: companyId, network: "linkedin",
      account_id: page.id, account_name: page.name,
      access_token: token, expires_at: expire,
      connected_at: new Date().toISOString(),
    }, { onConflict: "company_id,network" });
    if (upErr) return json({ error: "Enregistrement échoué : " + upErr.message }, 500);

    return json({ ok: true, linkedin: page, expires_at: expire });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
