// Marketing IA — publication réelle sur les réseaux.
// Reçoit un post_id, va chercher le jeton de la société côté serveur et poste.
// Le navigateur ne voit jamais le jeton : il ne fait qu'appeler cette fonction.
//
// Facebook  : /{page}/photos si le post a une image, sinon /{page}/feed
// Instagram : conteneur /{ig}/media puis /{ig}/media_publish (image obligatoire)
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

// Meta enveloppe ses refus dans error.message ; on le remonte tel quel à David,
// c'est toujours plus parlant qu'un code HTTP.
async function graph(url: string, form: Record<string, string>) {
  const res = await fetch(url, { method: "POST", body: new URLSearchParams(form) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || `Meta a refusé (HTTP ${res.status})`);
  }
  return data;
}

// ---------- LinkedIn ----------
// L'image ne se passe pas par URL comme chez Meta : il faut demander un
// emplacement, y téléverser les octets, puis référencer l'URN obtenue.
const LI_API = "https://api.linkedin.com";
const LI_VERSION = "202405";

async function publierLinkedIn(orgId: string, token: string, texte: string, imageUrl?: string | null, alt?: string | null) {
  const entetes = {
    "Authorization": `Bearer ${token}`,
    "LinkedIn-Version": LI_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
  const auteur = `urn:li:organization:${orgId}`;
  let media: Record<string, unknown> | undefined;

  if (imageUrl) {
    const init = await fetch(`${LI_API}/rest/images?action=initializeUpload`, {
      method: "POST", headers: entetes,
      body: JSON.stringify({ initializeUploadRequest: { owner: auteur } }),
    });
    const initJson = await init.json().catch(() => ({}));
    const val = initJson?.value;
    if (!init.ok || !val?.uploadUrl || !val?.image) {
      throw new Error("LinkedIn refuse l'envoi de l'image : " + String(initJson?.message || init.status).slice(0, 200));
    }
    const bin = await fetch(imageUrl);
    if (!bin.ok) throw new Error("Visuel introuvable à son adresse.");
    const up = await fetch(val.uploadUrl, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${token}` },
      body: new Uint8Array(await bin.arrayBuffer()),
    });
    if (!up.ok) throw new Error(`Téléversement de l'image refusé (HTTP ${up.status}).`);
    media = { media: { id: val.image, altText: (alt || "").slice(0, 300) } };
  }

  // LinkedIn traite quelques caractères comme réservés dans le commentaire.
  const commentaire = texte.replace(/([(){}\[\]<>@|~_*#\\])/g, "\\$1");

  const res = await fetch(`${LI_API}/rest/posts`, {
    method: "POST", headers: entetes,
    body: JSON.stringify({
      author: auteur,
      commentary: commentaire,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      ...(media ? { content: media } : {}),
    }),
  });
  if (res.status !== 201 && !res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error("LinkedIn a refusé la publication : " + String(err?.message || res.status).slice(0, 220));
  }
  return res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || "";
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
    const postId = body.post_id;
    if (!postId) return json({ error: "Post manquant." }, 400);

    const { data: post } = await admin.from("mkt_posts")
      .select("id, company_id, network, body, caption, image_url, status, published_at")
      .eq("id", postId).maybeSingle();
    if (!post) return json({ error: "Post introuvable." }, 404);
    if (post.published_at) return json({ error: "Ce post a déjà été publié." }, 400);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, owner, name").eq("id", post.company_id).maybeSingle();
    if (!company || company.owner !== uid) return json({ error: "Accès refusé." }, 403);

    const { data: compte } = await admin.from("mkt_social")
      .select("network, account_id, access_token")
      .eq("company_id", post.company_id).eq("network", post.network).maybeSingle();
    if (!compte?.access_token || !compte.account_id) {
      return json({
        error: `${company.name} n'est pas encore connectée à ${post.network}. `
          + "Va dans Paramétrage → Connexion aux réseaux.",
      }, 400);
    }

    // Le texte du post ; la légende sert de complément quand elle existe.
    const texte = [post.body, post.caption].filter(Boolean).join("\n\n").trim();
    let externalId = "";

    if (post.network === "facebook") {
      if (post.image_url) {
        const r = await graph(`${GRAPH}/${compte.account_id}/photos`, {
          url: post.image_url, caption: texte, access_token: compte.access_token,
        });
        externalId = String(r.post_id || r.id || "");
      } else {
        const r = await graph(`${GRAPH}/${compte.account_id}/feed`, {
          message: texte, access_token: compte.access_token,
        });
        externalId = String(r.id || "");
      }
    } else if (post.network === "instagram") {
      if (!post.image_url) return json({ error: "Instagram exige une image : génère d'abord le visuel." }, 400);
      const conteneur = await graph(`${GRAPH}/${compte.account_id}/media`, {
        image_url: post.image_url, caption: texte, access_token: compte.access_token,
      });
      const r = await graph(`${GRAPH}/${compte.account_id}/media_publish`, {
        creation_id: String(conteneur.id), access_token: compte.access_token,
      });
      externalId = String(r.id || "");
    } else if (post.network === "linkedin") {
      externalId = await publierLinkedIn(compte.account_id, compte.access_token, texte, post.image_url, post.image_alt);
    } else {
      return json({ error: "Réseau inconnu : " + post.network }, 400);
    }

    const maintenant = new Date().toISOString();
    await admin.from("mkt_posts").update({
      status: "publie", published_at: maintenant,
      external_id: externalId || null, updated_at: maintenant,
    }).eq("id", postId);

    return json({ ok: true, external_id: externalId, network: post.network });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
