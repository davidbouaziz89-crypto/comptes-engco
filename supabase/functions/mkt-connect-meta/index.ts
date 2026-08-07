// Marketing IA — connexion des comptes Instagram et Facebook.
// David colle le jeton obtenu dans l'explorateur Meta ; cette fonction fait le reste :
//   1) l'échange contre un jeton longue durée
//   2) la liste de ses Pages et le jeton propre à chacune (celui-là n'expire pas)
//   3) le compte Instagram professionnel rattaché à la Page
//   4) l'enregistrement, côté serveur uniquement
//
// Secrets requis : META_APP_ID, META_APP_SECRET.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appId = Deno.env.get("META_APP_ID");
    const appSecret = Deno.env.get("META_APP_SECRET");
    if (!appId || !appSecret) {
      return json({ error: "Identifiants Meta manquants : ajoute META_APP_ID et META_APP_SECRET dans les secrets Supabase." }, 500);
    }
    const admin = createClient(url, serviceKey);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const companyId = body.company_id;
    const shortToken = String(body.token || "").trim();
    if (!companyId || !shortToken) return json({ error: "Société ou jeton manquant." }, 400);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, owner, name").eq("id", companyId).maybeSingle();
    if (!company || company.owner !== uid) return json({ error: "Accès refusé." }, 403);

    // 1) Jeton longue durée (60 jours)
    const ex = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(shortToken)}`);
    const exJson = await ex.json();
    if (!ex.ok || !exJson.access_token) {
      return json({ error: "Jeton refusé par Meta : " + JSON.stringify(exJson?.error?.message || exJson).slice(0, 220) }, 400);
    }
    const longToken = exJson.access_token as string;

    // 2) Les Pages administrées, avec leur propre jeton.
    // me/accounts ne voit que les Pages détenues en direct ; celles qui appartiennent
    // à un portfolio professionnel passent par /me/businesses (d'où business_management).
    type Page = { id: string; name: string; access_token: string };
    const pages: Page[] = [];
    const vus = new Set<string>();
    const ajoute = (arr: unknown) => {
      for (const p of (arr as Page[]) || []) {
        if (p?.id && p.access_token && !vus.has(p.id)) { vus.add(p.id); pages.push(p); }
      }
    };

    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(longToken)}`);
    const pagesJson = await pagesRes.json();
    ajoute(pagesJson?.data);

    if (!pages.length) {
      const bizRes = await fetch(`${GRAPH}/me/businesses?fields=id,name&limit=50&access_token=${encodeURIComponent(longToken)}`);
      const bizJson = await bizRes.json();
      for (const b of (bizJson?.data || []) as { id: string }[]) {
        for (const rel of ["owned_pages", "client_pages"]) {
          const r = await fetch(`${GRAPH}/${b.id}/${rel}?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(longToken)}`);
          ajoute((await r.json())?.data);
        }
      }
      if (!pages.length) {
        // Diagnostic : ce que Meta a réellement accordé, et ce qu'il a répondu.
        const permRes = await fetch(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(longToken)}`);
        const permJson = await permRes.json();
        const accordees = ((permJson?.data || []) as { permission: string; status: string }[])
          .filter((p) => p.status === "granted").map((p) => p.permission);
        return json({
          error: "Aucune Page trouvée.",
          diagnostic: {
            autorisations_accordees: accordees,
            me_accounts: pagesJson?.error?.message || `${(pagesJson?.data || []).length} Page(s)`,
            me_businesses: bizJson?.error?.message || `${(bizJson?.data || []).length} portfolio(s)`,
          },
        }, 400);
      }
    }

    // Si David a précisé la Page, on la prend ; sinon on essaie de la reconnaître par le nom de la société.
    let page = body.page_id ? pages.find((p) => p.id === String(body.page_id)) : undefined;
    if (!page) {
      const nom = String(company.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      page = pages.find((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(nom))
        || (pages.length === 1 ? pages[0] : undefined);
    }
    if (!page) {
      return json({
        ok: true, need_choice: true,
        pages: pages.map((p) => ({ id: p.id, name: p.name })),
        message: "Plusieurs Pages disponibles : dis-moi laquelle rattacher à cette société.",
      });
    }

    // 3) Le compte Instagram professionnel rattaché
    const igRes = await fetch(`${GRAPH}/${page.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(page.access_token)}`);
    const igJson = await igRes.json();
    const ig = igJson?.instagram_business_account;

    // 4) Enregistrement, jeton côté serveur uniquement
    const lignes: Record<string, unknown>[] = [{
      company_id: companyId, network: "facebook",
      account_id: page.id, account_name: page.name,
      access_token: page.access_token, expires_at: null,
      connected_at: new Date().toISOString(),
    }];
    if (ig?.id) {
      lignes.push({
        company_id: companyId, network: "instagram",
        account_id: ig.id, account_name: ig.username || page.name,
        access_token: page.access_token, expires_at: null,
        connected_at: new Date().toISOString(),
      });
    }
    const { error: upErr } = await admin.from("mkt_social")
      .upsert(lignes, { onConflict: "company_id,network" });
    if (upErr) return json({ error: "Enregistrement échoué : " + upErr.message }, 500);

    // 5) Le compte publicitaire, s'il y en a un : c'est le jeton *utilisateur* qui
    // porte ads_management, pas celui de la Page. On le garde à part.
    let pub: { id: string; name: string } | null = null;
    try {
      const adRes = await fetch(`${GRAPH}/me/adaccounts?fields=account_id,name,account_status&limit=25&access_token=${encodeURIComponent(longToken)}`);
      const adJson = await adRes.json();
      const comptes = ((adJson?.data || []) as { account_id: string; name: string; account_status: number }[])
        .filter((c) => c.account_id);
      const choisi = body.ad_account_id
        ? comptes.find((c) => c.account_id === String(body.ad_account_id))
        : comptes.find((c) => c.account_status === 1) || comptes[0];
      if (choisi) {
        pub = { id: choisi.account_id, name: choisi.name || choisi.account_id };
        await admin.from("mkt_meta_ads").upsert({
          company_id: companyId,
          ad_account_id: choisi.account_id,
          ad_account_name: choisi.name || null,
          user_token: longToken,
          expires_at: exJson.expires_in
            ? new Date(Date.now() + Number(exJson.expires_in) * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "company_id" });
      }
    } catch (_) { /* la publicité est un bonus : son échec ne casse pas la connexion */ }

    return json({
      ok: true,
      facebook: { id: page.id, name: page.name },
      instagram: ig?.id ? { id: ig.id, name: ig.username } : null,
      publicite: pub,
      warning: ig?.id ? null : "Page connectée, mais aucun compte Instagram professionnel ne lui est rattaché.",
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
