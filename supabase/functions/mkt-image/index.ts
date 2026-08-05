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

// Format d'image le plus performant selon le réseau.
const RATIO: Record<string, string> = { linkedin: "16:9", facebook: "16:9", instagram: "4:5" };

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
    console.error("ANTHROPIC_ERROR", m, resp.status, txt.slice(0, 300));
    if (resp.status !== 404 && resp.status !== 400) throw new Error("Erreur IA (" + resp.status + ") : " + txt.slice(0, 200));
    if (m === "claude-opus-4-8") throw new Error("Erreur IA (" + resp.status + ") : " + txt.slice(0, 200));
  }
  throw new Error("Modèle IA indisponible.");
}

// Appelle Gemini, en retombant sur le modèle précédent si besoin.
async function callGemini(apiKey: string, model: string, prompt: string, aspectRatio: string) {
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      responseFormat: { image: { aspectRatio } },
    },
  };
  for (const m of [model, "gemini-2.5-flash-image"]) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${m}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (resp.ok) return await resp.json();
    const txt = await resp.text();
    console.error("GEMINI_ERROR", m, resp.status, txt.slice(0, 300));
    if (m === "gemini-2.5-flash-image" || (resp.status !== 404 && resp.status !== 400)) {
      throw new Error("Erreur image (" + resp.status + ") : " + txt.slice(0, 200));
    }
  }
  throw new Error("Modèle d'image indisponible.");
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

Ta mission :
- Choisis TOI-MÊME le style le plus efficace pour ce post et ce réseau (visuel de marque avec accroche écrite, photo réaliste, illustration, 3D ou abstrait). LinkedIn = crédible et pro ; Instagram = plus créatif et coloré ; Facebook = chaleureux et accessible.
- Rédige une consigne d'image en ANGLAIS, très concrète et détaillée : sujet, composition, cadrage, lumière, palette de couleurs, ambiance, niveau de détail.
- N'inclus JAMAIS de logo inventé, de fausse marque, de visage de personne réelle ni de texte illisible.
- Si le style choisi comporte du texte incrusté, précise le texte exact entre guillemets, en français, 6 mots maximum, et demande une typographie moderne et parfaitement lisible.
- Le rendu doit ressembler à un visuel de marque professionnel, surtout pas à une image générique de banque d'images.`;

    const out = await callClaude(anthropicKey, artModel, instruction);
    if (out.stop_reason === "refusal") throw new Error("Direction artistique refusée par l'IA.");
    const textBlock = (out.content || []).find((b: { type: string }) => b.type === "text");
    const art = textBlock ? tryParseJson(String(textBlock.text || "")) as { style?: string; prompt?: string; alt?: string } : null;
    if (!art || !art.prompt) throw new Error("Direction artistique illisible. Réessaie.");

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
    const bytes = Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0));

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

    return json({ ok: true, post_id: postId, image_url: imageUrl, style: art.style, alt: art.alt });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (postId) {
      await admin.from("mkt_posts").update({ image_status: "error", image_error: msg.slice(0, 400) }).eq("id", postId);
    }
    return json({ error: msg }, 500);
  }
});
