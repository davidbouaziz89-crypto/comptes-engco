// Marketing IA — agent "Directeur artistique" : crée le visuel d'un post.
// 1) Claude choisit le style et rédige la consigne visuelle selon la marque et le réseau.
// 2) Google Gemini génère l'image.
// 3) L'image est stockée dans le bucket public `mkt-images` et reliée au post.
//
// Secrets requis : ANTHROPIC_API_KEY (déjà posé), GEMINI_API_KEY (à poser).
// Secrets optionnels : MKT_ART_MODEL (modèle Claude), MKT_IMAGE_MODEL (modèle Gemini).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Décodage rapide, délégué au moteur : `atob` + boucle caractère par caractère
// faisait exploser le budget CPU de la fonction sur des images de plusieurs Mo (erreur 546).
async function b64ToBytes(b64: string, mime: string): Promise<Uint8Array> {
  const res = await fetch(`data:${mime};base64,${b64}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Le corps d'une erreur 429 précise le quota en cause (palier gratuit ou payant) : on le remonte.
function quotaDetail(txt: string): string {
  try {
    const j = JSON.parse(txt);
    const det = (j?.error?.details || []).find((d: { "@type"?: string }) => String(d["@type"] || "").includes("QuotaFailure"));
    const v = det?.violations?.[0];
    const id = v?.quotaId || v?.quotaMetric;
    return id ? " [" + id + "]" : "";
  } catch (_) { return ""; }
}

// --- Suivi des frais IA (tarifs publics Anthropic, en dollars par million de tokens) ---
const PRICE: Record<string, { i: number; o: number }> = {
  "claude-opus-5": { i: 5, o: 25 },
  "claude-opus-4-8": { i: 5, o: 25 },
  "claude-sonnet-5": { i: 3, o: 15 },
  "claude-haiku-4-5": { i: 1, o: 5 },
};
function claudeCost(model: string, u: Record<string, number> | null) {
  const p = PRICE[model] || PRICE["claude-opus-5"];
  const inT = u?.input_tokens || 0, outT = u?.output_tokens || 0, cache = u?.cache_read_input_tokens || 0;
  return (inT * p.i + outT * p.o + cache * p.i * 0.1) / 1_000_000;
}
// Jamais bloquant : un souci de journalisation ne doit pas casser la fonctionnalité.
async function logUsage(admin: { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } }, row: Record<string, unknown>) {
  try { await admin.from("mkt_usage").insert(row); } catch (e) { console.error("USAGE_LOG_FAIL", String(e)); }
}

const IMAGE_PRICE_USD = 0.04; // estimation par image ; le quota gratuit Google n'est pas déduit

// Format d'image le plus performant selon le réseau.
// Google n'accepte qu'une liste courte de ratios : 1:1, 3:4, 4:3, 9:16, 16:9.
const RATIO: Record<string, string> = { linkedin: "16:9", facebook: "16:9", instagram: "3:4" };

const ART_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    style: {
      type: "string",
      enum: ["visuel_de_marque", "photo", "illustration", "3d", "abstrait"],
      description: "Le style choisi pour CE post, selon le réseau et le sujet",
    },
    prompt: {
      type: "string",
      description:
        "La consigne complète pour le générateur d'images, en ANGLAIS, très concrète (sujet, cadrage, lumière, palette, ambiance). Si du texte doit apparaître sur l'image, l'indiquer entre guillemets, en français, 6 mots maximum.",
    },
    alt: { type: "string", description: "Description courte de l'image en français (accessibilité)" },
  },
  required: ["style", "prompt", "alt"],
};

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  const t = s.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* continue */ } }
  return null;
}

// Appelle Claude, en retombant sur un modèle éprouvé si le modèle demandé n'existe pas sur la clé.
async function callClaude(apiKey: string, model: string, instruction: string) {
  const body = {
    max_tokens: 2000,
    output_config: { format: { type: "json_schema", schema: ART_SCHEMA } },
    messages: [{ role: "user", content: [{ type: "text", text: instruction }] }],
  };
  for (const m of [model, "claude-opus-4-8"]) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: m, ...body }),
    });
    if (resp.ok) return await resp.json();
    const txt = await resp.text();
    console.error("ANTHROPIC_ERROR", m, resp.status, txt.slice(0, 1200));
    if (resp.status !== 404 && resp.status !== 400) throw new Error("Erreur IA (" + resp.status + ") : " + txt.slice(0, 200));
    if (m === "claude-opus-4-8") throw new Error("Erreur IA (" + resp.status + ") : " + txt.slice(0, 200));
  }
  throw new Error("Modèle IA indisponible.");
}

// Le nom du réglage de format change selon la version d'API exposée par la clé.
// On essaie les variantes connues, puis on génère sans contrainte de format :
// mieux vaut une image au format par défaut que pas d'image du tout.
// `imageConfig` est la forme acceptée aujourd'hui ; `responseFormat` ne l'est plus
// sur toutes les versions. On garde les deux, puis on génère sans contrainte de format.
// On demande la haute définition en premier : c'est ce qui change tout sur la qualité perçue.
function imageConfigs(aspectRatio: string) {
  return [
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio, imageSize: "2K" } },
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
    { responseModalities: ["IMAGE"], responseFormat: { image: { aspectRatio, imageSize: "2K" } } },
    { responseModalities: ["IMAGE"], responseFormat: { image: { aspectRatio } } },
    { responseModalities: ["IMAGE"] },
  ];
}

export const QUOTA_MSG =
  "Quota Google épuisé. La génération d'images n'est pas couverte par le palier gratuit de ta clé, " +
  "ou le quota du jour est atteint. Active la facturation sur ton projet Google AI Studio " +
  "(https://aistudio.google.com/apikey) ou attends la remise à zéro.";

async function callGemini(apiKey: string, model: string, prompt: string, aspectRatio: string) {
  let lastErr = "", quota = false;
  for (const m of [model, "gemini-2.5-flash-image"]) {
    for (const generationConfig of imageConfigs(aspectRatio)) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${m}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        },
      );
      if (resp.ok) return await resp.json();
      const txt = await resp.text();
      lastErr = txt;
      console.error("GEMINI_ERROR", m, resp.status, txt.slice(0, 1200));
      if (resp.status === 400) continue;      // réglage refusé : variante suivante
      if (resp.status === 404) break;         // modèle inconnu : modèle suivant
      if (resp.status === 429) { quota = true; break; }  // quota : un autre modèle a peut-être du crédit
      throw new Error("Erreur image (" + resp.status + ") : " + txt.slice(0, 200));
    }
  }
  if (quota) throw new Error(QUOTA_MSG + quotaDetail(lastErr));
  throw new Error("Erreur image : " + lastErr.slice(0, 250));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let postId: string | null = null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  try {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!anthropicKey) return json({ error: "Clé IA non configurée (ANTHROPIC_API_KEY manquante)." }, 500);
    if (!geminiKey) {
      return json({ error: "Clé image non configurée : ajoute le secret GEMINI_API_KEY dans Supabase (Edge Functions → Secrets)." }, 500);
    }
    const artModel = Deno.env.get("MKT_ART_MODEL") || "claude-opus-5";
    const imageModel = Deno.env.get("MKT_IMAGE_MODEL") || "gemini-3.1-flash-image";

    // 1) Auth
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    postId = body.post_id;
    if (!postId) return json({ error: "post_id manquant." }, 400);

    // 2) Charger le post + la société + la ligne éditoriale
    const { data: post } = await admin.from("mkt_posts")
      .select("id, company_id, network, body, visual_idea, caption").eq("id", postId).maybeSingle();
    if (!post) return json({ error: "Post introuvable." }, 404);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, name, activity, owner").eq("id", post.company_id).maybeSingle();
    if (!company) return json({ error: "Société introuvable." }, 404);
    if (company.owner !== uid) return json({ error: "Accès refusé à ce post." }, 403);

    const { data: edit } = await admin.from("mkt_editorial").select("*").eq("company_id", post.company_id).maybeSingle();

    await admin.from("mkt_posts").update({ image_status: "pending", image_error: null }).eq("id", postId);

    // 3) Directeur artistique : choix du style + consigne visuelle
    const ed = edit || {};
    const brandBlock = [
      ed.summary ? `La société : ${ed.summary}` : null,
      ed.tone ? `Ton de la marque : ${ed.tone}` : null,
      ed.audience ? `Cible : ${ed.audience}` : null,
      ed.brand_colors ? `Couleurs de la marque à respecter : ${ed.brand_colors}` : null,
      ed.donts ? `À éviter absolument : ${ed.donts}` : null,
    ].filter(Boolean).join("\n");

    const instruction = `Tu es le directeur artistique de « ${company.name} »${company.activity ? ` (${company.activity})` : ""}.
Tu dois créer le visuel qui accompagnera ce post ${post.network}.

${brandBlock || "Aucune ligne éditoriale renseignée : reste sobre et professionnel."}

Texte du post :
"""${(post.body || "").slice(0, 1200)}"""

Idée de visuel proposée par le rédacteur : ${post.visual_idea || "(aucune)"}

Ta mission : rédiger la consigne d'un visuel de qualité professionnelle, digne d'une agence.

1) Choisis TOI-MÊME le style le plus efficace pour ce post et ce réseau (visuel de marque avec accroche écrite, photo réaliste, illustration, 3D ou abstrait). LinkedIn = crédible et sobre ; Instagram = plus créatif et coloré ; Facebook = chaleureux et accessible.

2) Rédige la consigne en ANGLAIS, riche et précise, en couvrant explicitement :
- LE SUJET : UN seul sujet principal, clairement identifiable. Pas de collage d'idées, pas de scène chargée.
- LA COMPOSITION : cadrage, angle, point de fuite, règle des tiers, profondeur de champ.
- L'OPTIQUE : type de prise de vue (ex. 35mm f/2, macro, vue du dessus) ou le rendu (ex. 3D isométrique, illustration vectorielle plate).
- LA LUMIÈRE : direction, douceur, contraste, heure de la journée.
- LA PALETTE : nomme 2 ou 3 couleurs précises, cohérentes avec la marque.
- LA MATIÈRE et L'AMBIANCE : textures, finition, émotion recherchée.
- Termine par : "editorial quality, art-directed, sharp focus, high detail, professional colour grading".

3) Règles absolues :
- Laisse une zone calme et dégagée en bas à droite : le logo de la société y sera incrusté.
- Aucun logo inventé, aucune marque existante, aucun visage de personne réelle, aucun texte parasite.
- Interdits explicites à mentionner dans la consigne : "no watermark, no signature, no gibberish text, no distorted hands, no cluttered composition, no generic stock-photo look, no cheesy business clichés such as handshakes over cityscapes or glowing brains".
- Si le style comporte du texte incrusté, indique le texte exact entre guillemets, en français, 6 mots maximum, avec une typographie sans-serif moderne, très lisible, bien contrastée.
- Le résultat doit ressembler à une campagne de marque soignée, jamais à une banque d'images.`;

    const out = await callClaude(anthropicKey, artModel, instruction);
    if (out.stop_reason === "refusal") throw new Error("Direction artistique refusée par l'IA.");
    const textBlock = (out.content || []).find((b: { type: string }) => b.type === "text");
    const art = textBlock ? tryParseJson(String(textBlock.text || "")) as { style?: string; prompt?: string; alt?: string } : null;
    if (!art || !art.prompt) throw new Error("Direction artistique illisible. Réessaie.");

    await logUsage(admin, {
      owner: uid, company_id: post.company_id, source: "image", agent: "designer",
      provider: "anthropic", model: out.model || artModel,
      input_tokens: out.usage?.input_tokens || 0,
      output_tokens: out.usage?.output_tokens || 0,
      cache_read_tokens: out.usage?.cache_read_input_tokens || 0,
      cost_usd: claudeCost(out.model || artModel, out.usage || null),
    });

    // 4) Génération de l'image
    const ratio = RATIO[post.network] || "16:9";
    const gem = await callGemini(geminiKey, imageModel, art.prompt, ratio);
    const parts = gem?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data)?.inlineData;
    if (!inline?.data) {
      const reason = gem?.candidates?.[0]?.finishReason || gem?.promptFeedback?.blockReason || "aucune image renvoyée";
      throw new Error("Image non générée (" + reason + ").");
    }
    const mime = inline.mimeType || "image/png";
    const ext = mime.includes("jpeg") ? "jpg" : "png";
    const bytes = await b64ToBytes(inline.data, mime);

    // 5) Stockage + lien sur le post
    const path = `${post.company_id}/${post.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage.from("mkt-images")
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) throw new Error("Stockage échoué : " + upErr.message);
    const { data: pub } = admin.storage.from("mkt-images").getPublicUrl(path);
    const imageUrl = pub.publicUrl;

    const { error: updErr } = await admin.from("mkt_posts").update({
      image_url: imageUrl,
      image_prompt: art.prompt,
      image_style: art.style || null,
      image_alt: art.alt || null,
      image_status: "ready",
      image_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", postId);
    if (updErr) throw new Error("Enregistrement échoué : " + updErr.message);

    await logUsage(admin, {
      owner: uid, company_id: post.company_id, source: "image", agent: "designer",
      provider: "google", model: imageModel, images: 1, cost_usd: IMAGE_PRICE_USD,
    });

    return json({ ok: true, post_id: postId, image_url: imageUrl, style: art.style, alt: art.alt });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (postId) {
      await admin.from("mkt_posts").update({ image_status: "error", image_error: msg.slice(0, 400) }).eq("id", postId);
    }
    return json({ error: msg }, 500);
  }
});
