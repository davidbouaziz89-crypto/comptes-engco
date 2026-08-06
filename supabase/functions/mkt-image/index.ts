// Marketing IA — agent "Directeur artistique" : crée le visuel d'un post.
// 1) Claude choisit le style et rédige la consigne visuelle selon la marque et le réseau.
// 2) Google Gemini génère l'image.
// 3) L'image est stockée dans le bucket public `mkt-images` et reliée au post.
//
// Secrets requis : ANTHROPIC_API_KEY (déjà posé), GEMINI_API_KEY (à poser).
// Secrets optionnels : MKT_ART_MODEL (modèle Claude), MKT_IMAGE_MODEL (modèle Gemini).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Ce que David a précisé aux agents : ces réponses valent autant que la ligne éditoriale.
// deno-lint-ignore no-explicit-any
async function factsBlock(admin: any, companyId: string): Promise<string> {
  try {
    const { data } = await admin.from("mkt_facts")
      .select("question, answer").eq("company_id", companyId).not("answer", "is", null);
    if (!data || !data.length) return "";
    return "\n\nPrécisions données par David :\n"
      + data.map((f: { question: string; answer: string }) => `- ${f.question} → ${f.answer}`).join("\n");
  } catch (_) { return ""; }
}

// Enregistre une question de l'équipe, sans doublon.
// deno-lint-ignore no-explicit-any
async function askFact(admin: any, companyId: string, question: string, agent: string) {
  const q = String(question || "").trim();
  if (!q) return;
  try {
    const { data } = await admin.from("mkt_facts").select("id").eq("company_id", companyId).ilike("question", q);
    if (data && data.length) return;
    await admin.from("mkt_facts").insert({ company_id: companyId, question: q, asked_by: agent });
  } catch (e) { console.error("FACT_ASK_FAIL", String(e)); }
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
    headline: {
      type: "string",
      description: "L'accroche à incruster sur le visuel, en FRANÇAIS, 3 à 6 mots maximum, percutante et concrète. Pas de point final.",
    },
    alt: { type: "string", description: "Description courte de l'image en français (accessibilité)" },
  },
  required: ["style", "prompt", "headline", "alt"],
};

// Mode « visuel designé » : pas de photo générée, l'IA conçoit la mise en page
// et l'app la dessine au pixel près. C'est ce qui donne un rendu d'agence.
const DESIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    layout: {
      type: "string",
      enum: ["statement", "stat", "split"],
      description: "statement = une affirmation forte ; stat = un chiffre qui frappe ; split = promesse + preuve",
    },
    kicker: { type: "string", description: "Surtitre très court en MAJUSCULES, 2 à 4 mots (ex. GÉNÉRATION DE LEADS)" },
    headline: { type: "string", description: "L'accroche principale, 4 à 8 mots, percutante. Pas de point final." },
    subline: { type: "string", description: "Une phrase de soutien, 8 à 16 mots, concrète." },
    stat: { type: "string", description: "Le chiffre choc, très court (ex. « 3× », « 48 h », « +120 »). Vide si layout ≠ stat." },
    stat_label: { type: "string", description: "Ce que mesure le chiffre, 2 à 5 mots. Vide si layout ≠ stat." },
  },
  required: ["layout", "kicker", "headline", "subline", "stat", "stat_label"],
};

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  const t = s.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* continue */ } }
  return null;
}

// Appelle Claude, en retombant sur un modèle éprouvé si le modèle demandé n'existe pas sur la clé.
async function callClaude(apiKey: string, model: string, instruction: string, schema: unknown = ART_SCHEMA) {
  const body = {
    max_tokens: 2000,
    output_config: { format: { type: "json_schema", schema } },
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

async function callGemini(apiKey: string, model: string, prompt: string, aspectRatio: string,
                          ref?: { data: string; mime: string }) {
  const parts: unknown[] = [];
  if (ref) parts.push({ inline_data: { mime_type: ref.mime, data: ref.data } });
  parts.push({ text: prompt });
  let lastErr = "", quota = false;
  for (const m of [model, "gemini-2.5-flash-image"]) {
    for (const generationConfig of imageConfigs(aspectRatio)) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${m}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts }], generationConfig }),
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
      .select("id, company_id, network, body, visual_idea, caption, image_url, image_raw_url, image_headline, image_style").eq("id", postId).maybeSingle();
    if (!post) return json({ error: "Post introuvable." }, 404);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, name, activity, owner, logo_url").eq("id", post.company_id).maybeSingle();
    if (!company) return json({ error: "Société introuvable." }, 404);
    if (company.owner !== uid) return json({ error: "Accès refusé à ce post." }, 403);

    const { data: edit } = await admin.from("mkt_editorial").select("*").eq("company_id", post.company_id).maybeSingle();

    await admin.from("mkt_posts").update({ image_status: "pending", image_error: null }).eq("id", postId);

    // ---- Mode « retouche » : on garde la photo et on ne change que ce qui est demandé ----
    if (body.mode === "retouche") {
      const source = post.image_raw_url || post.image_url;
      if (!source) throw new Error("Aucune image à retoucher : génère d'abord un visuel.");
      const consigne = String(body.instruction || "").trim();
      if (!consigne) throw new Error("Dis-moi ce qu'il faut changer sur l'image.");

      const src = await fetch(source);
      if (!src.ok) throw new Error("Image d'origine illisible.");
      const srcMime = src.headers.get("content-type") || "image/png";
      const srcB64 = encodeBase64(new Uint8Array(await src.arrayBuffer()));

      const prompt = `Edit the provided image. Keep the SAME photograph: same scene, same subject, same composition, `
        + `same framing, same lighting, same colours. Do not regenerate it, do not change the style. `
        + `Apply ONLY this change: ${consigne}. `
        + `Keep the lower third visually calm — a caption bar will be added there afterwards. `
        + `No text, no letters, no watermark. Photorealistic, seamless, high detail.`;

      const gemR = await callGemini(geminiKey, imageModel, prompt, RATIO[post.network] || "16:9",
        { data: srcB64, mime: srcMime });
      const partsR = gemR?.candidates?.[0]?.content?.parts || [];
      const inlR = partsR.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data)?.inlineData;
      if (!inlR?.data) {
        const reason = gemR?.candidates?.[0]?.finishReason || gemR?.promptFeedback?.blockReason || "aucune image renvoyée";
        throw new Error("Retouche impossible (" + reason + ").");
      }
      const mimeR = inlR.mimeType || "image/png";
      const bytesR = await b64ToBytes(inlR.data, mimeR);
      const pathR = `${post.company_id}/${post.id}-retouche-${Date.now()}.${mimeR.includes("jpeg") ? "jpg" : "png"}`;
      const { error: upR } = await admin.storage.from("mkt-images")
        .upload(pathR, bytesR, { contentType: mimeR, upsert: true });
      if (upR) throw new Error("Stockage échoué : " + upR.message);
      const urlR = admin.storage.from("mkt-images").getPublicUrl(pathR).data.publicUrl;

      await admin.from("mkt_posts").update({
        image_raw_url: urlR, image_url: urlR, image_status: "ready", image_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", postId);

      await logUsage(admin, {
        owner: uid, company_id: post.company_id, source: "image", agent: "designer",
        provider: "google", model: imageModel, images: 1, cost_usd: IMAGE_PRICE_USD,
      });

      return json({ ok: true, mode: "retouche", post_id: postId, image_url: urlR,
        headline: post.image_headline || "", style: post.image_style || "" });
    }

    // ---- Mode « visuel designé » : l'IA conçoit, l'app dessine. Aucune image générée. ----
    if (body.mode === "design") {
      const ed2 = edit || {};
      const brief = `Tu es directeur artistique pour « ${company.name} »${company.activity ? ` (${company.activity})` : ""}.
Conçois un visuel de marque, typographique, pour ce post ${post.network}.

${[ed2.summary && `La société : ${ed2.summary}`, ed2.tone && `Ton : ${ed2.tone}`, ed2.audience && `Cible : ${ed2.audience}`].filter(Boolean).join("\n") || "Reste sobre et professionnel."}

Texte du post :
"""${(post.body || "").slice(0, 1200)}"""

Choisis la mise en page la plus juste et écris les textes, en français :
- « statement » quand le post porte une affirmation forte ou une promesse.
- « stat » quand le post contient (ou permet d'extraire honnêtement) un chiffre marquant. N'invente jamais un chiffre absent du post.
- « split » quand il y a une promesse et une preuve à opposer.
Textes courts, concrets, sans superlatif creux, sans jargon, sans emoji. L'accroche doit se lire en une seconde.${body.instruction ? `

DEMANDE EXPRESSE DE DAVID, prioritaire : ${String(body.instruction).slice(0, 600)}` : ""}`;

      const outD = await callClaude(anthropicKey, artModel, brief, DESIGN_SCHEMA);
      const tbD = (outD.content || []).find((b: { type: string }) => b.type === "text");
      const spec = tbD ? tryParseJson(String(tbD.text || "")) as Record<string, string> : null;
      if (!spec || !spec.headline) throw new Error("Conception illisible. Réessaie.");

      await logUsage(admin, {
        owner: uid, company_id: post.company_id, source: "design", agent: "designer",
        provider: "anthropic", model: outD.model || artModel,
        input_tokens: outD.usage?.input_tokens || 0,
        output_tokens: outD.usage?.output_tokens || 0,
        cache_read_tokens: outD.usage?.cache_read_input_tokens || 0,
        cost_usd: claudeCost(outD.model || artModel, outD.usage || null),
      });

      await admin.from("mkt_posts").update({
        image_headline: spec.headline, image_style: "designé",
        image_alt: spec.subline || null, image_status: "pending",
        updated_at: new Date().toISOString(),
      }).eq("id", postId);

      return json({ ok: true, mode: "design", post_id: postId, design: spec, network: post.network });
    }

    // 3) Directeur artistique : choix du style + consigne visuelle
    const ed = edit || {};
    const brandBlock = [
      ed.summary ? `La société : ${ed.summary}` : null,
      ed.tone ? `Ton de la marque : ${ed.tone}` : null,
      ed.audience ? `Cible : ${ed.audience}` : null,
      ed.brand_colors ? `Couleurs de la marque à respecter : ${ed.brand_colors}` : null,
      company.logo_url ? "Logo : déjà fourni, l'app l'incruste elle-même sur le bandeau — ne le redemande pas et ne le dessine pas." : null,
      ed.donts ? `À éviter absolument : ${ed.donts}` : null,
    ].filter(Boolean).join("\n") + await factsBlock(admin, post.company_id);

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

3) Règles absolues — l'image que tu décris est un ARRIÈRE-PLAN :
- L'accroche et le logo seront incrustés ensuite par le logiciel, proprement. Donc **l'image ne doit contenir AUCUN texte** : demande explicitement "absolutely no text, no letters, no numbers, no typography, no signage, no watermark".
- Compose en gardant **le tiers inférieur visuellement calme et peu détaillé** (dégradé, matière, flou, ombre) : c'est là que le texte sera posé. Le sujet principal occupe la moitié haute ou un côté.
- Aucun logo inventé, aucune marque existante, aucun visage de personne réelle.
- Autres interdits à mentionner : "no gibberish text, no distorted hands, no cluttered composition, no generic stock-photo look, no cheesy business clichés such as handshakes over cityscapes or glowing brains".
- Le résultat doit ressembler à une campagne de marque soignée, jamais à une banque d'images.

4) L'accroche (headline) : elle sera écrite en gros sur le visuel. Elle doit accrocher l'œil, dire un bénéfice concret, et tenir en 3 à 6 mots.${body.instruction ? `

5) DEMANDE EXPRESSE DE DAVID, prioritaire sur tout le reste : ${String(body.instruction).slice(0, 600)}` : ""}`;

    const out = await callClaude(anthropicKey, artModel, instruction);
    if (out.stop_reason === "refusal") throw new Error("Direction artistique refusée par l'IA.");
    const textBlock = (out.content || []).find((b: { type: string }) => b.type === "text");
    const art = textBlock ? tryParseJson(String(textBlock.text || "")) as { style?: string; prompt?: string; headline?: string; alt?: string } : null;
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
      image_raw_url: imageUrl,
      image_prompt: art.prompt,
      image_style: art.style || null,
      image_alt: art.alt || null,
      image_headline: art.headline || null,
      image_status: "ready",
      image_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", postId);
    if (updErr) throw new Error("Enregistrement échoué : " + updErr.message);

    await logUsage(admin, {
      owner: uid, company_id: post.company_id, source: "image", agent: "designer",
      provider: "google", model: imageModel, images: 1, cost_usd: IMAGE_PRICE_USD,
    });

    return json({ ok: true, post_id: postId, image_url: imageUrl, style: art.style, alt: art.alt, headline: art.headline || "" });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (postId) {
      await admin.from("mkt_posts").update({ image_status: "error", image_error: msg.slice(0, 400) }).eq("id", postId);
    }
    return json({ error: msg }, 500);
  }
});
