// Marketing IA — portraits de l'équipe.
// Génère de vrais portraits (photo studio, même lumière pour toute l'équipe) via Gemini,
// les range dans le bucket `mkt-images` et les enregistre dans `mkt_team`.
// Secret requis : GEMINI_API_KEY. Optionnel : MKT_IMAGE_MODEL.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const IMAGE_PRICE_USD = 0.04; // estimation par image ; le quota gratuit Google n'est pas déduit

// Même studio, même lumière, même cadrage pour les quatre : ils doivent former une équipe.
const STUDIO =
  "Professional corporate headshot of a fictional person (not a real or recognisable individual), " +
  "shoulders-up portrait, facing the camera, warm natural smile, relaxed and confident. " +
  "Shot on a 85mm lens at f/2, soft diffused key light from the left, gentle fill, subtle rim light. " +
  "Background: a modern bright open-plan office, heavily blurred into soft bokeh, cool neutral tones. " +
  "Photorealistic, sharp focus on the eyes, natural skin texture, no retouching plastic look. " +
  "No text, no watermark, no logo, no border.";

const TEAM: Record<string, { first_name: string; role: string; look: string }> = {
  orchestrateur: {
    first_name: "Marc", role: "Chef de projet marketing",
    look: "A man in his early forties, short salt-and-pepper hair, neatly trimmed short beard, light brown eyes, wearing a navy blue shirt with the collar open.",
  },
  analyste: {
    first_name: "Léa", role: "Analyste de marque",
    look: "A woman in her early thirties, wavy chestnut hair loosely tied back, thin gold-rimmed glasses, green eyes, wearing a beige blazer over a white top.",
  },
  redacteur: {
    first_name: "Pierre", role: "Responsable marketing & rédaction",
    look: "A man in his mid thirties with warm brown skin, short curly dark hair, clean shaven, dark eyes, wearing a soft grey crew-neck sweater.",
  },
  designer: {
    first_name: "Nina", role: "Directrice artistique",
    look: "A woman in her late twenties with East Asian features, sleek black shoulder-length bob, small delicate earrings, wearing a crisp white shirt.",
  },
};

// Le nom du réglage de format change selon la version d'API exposée par la clé :
// on essaie les variantes connues avant de générer sans contrainte.
function imageConfigs() {
  return [
    { responseModalities: ["IMAGE"], responseFormat: { image: { aspectRatio: "1:1" } } },
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
    { responseModalities: ["IMAGE"] },
  ];
}

async function generatePortrait(apiKey: string, model: string, look: string) {
  const prompt = `${look} ${STUDIO}`;
  let lastErr = "";
  for (const m of [model, "gemini-2.5-flash-image"]) {
    for (const generationConfig of imageConfigs()) {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1/models/${m}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      });
      if (resp.ok) {
        const gem = await resp.json();
        const parts = gem?.candidates?.[0]?.content?.parts || [];
        const inline = parts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data)?.inlineData;
        if (!inline?.data) {
          const reason = gem?.candidates?.[0]?.finishReason || gem?.promptFeedback?.blockReason || "aucune image renvoyée";
          throw new Error("Portrait non généré (" + reason + ").");
        }
        return { data: inline.data as string, mime: (inline.mimeType as string) || "image/png", model: m, prompt };
      }
      const txt = await resp.text();
      lastErr = txt;
      console.error("GEMINI_ERROR", m, resp.status, txt.slice(0, 300));
      if (resp.status === 400) continue;
      if (resp.status === 404) break;
      throw new Error("Erreur image (" + resp.status + ") : " + txt.slice(0, 200));
    }
  }
  throw new Error("Erreur image : " + lastErr.slice(0, 250));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const imageModel = Deno.env.get("MKT_IMAGE_MODEL") || "gemini-3.1-flash-image";
    if (!geminiKey) return json({ error: "Clé image non configurée : ajoute le secret GEMINI_API_KEY dans Supabase." }, 500);
    const admin = createClient(url, serviceKey);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const only = body.agent && TEAM[body.agent] ? String(body.agent) : null;

    const { data: existing } = await admin.from("mkt_team").select("agent_key, avatar_url").eq("owner", uid);
    const have = new Set((existing || []).filter((r: { avatar_url: string | null }) => r.avatar_url).map((r: { agent_key: string }) => r.agent_key));

    const keys = only ? [only] : Object.keys(TEAM).filter((k) => !have.has(k));
    if (!keys.length) return json({ ok: true, created: [], message: "Les portraits existent déjà." });

    const created: unknown[] = [];
    const usage: Record<string, unknown>[] = [];

    for (const key of keys) {
      const t = TEAM[key];
      const img = await generatePortrait(geminiKey, imageModel, t.look);
      const ext = img.mime.includes("jpeg") ? "jpg" : "png";
      const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
      const path = `team/${uid}/${key}-${Date.now()}.${ext}`;
      const { error: upErr } = await admin.storage.from("mkt-images")
        .upload(path, bytes, { contentType: img.mime, upsert: true });
      if (upErr) throw new Error("Stockage échoué : " + upErr.message);
      const { data: pub } = admin.storage.from("mkt-images").getPublicUrl(path);

      const { error: tErr } = await admin.from("mkt_team").upsert({
        owner: uid, agent_key: key, first_name: t.first_name, role: t.role,
        avatar_url: pub.publicUrl, updated_at: new Date().toISOString(),
      }, { onConflict: "owner,agent_key" });
      if (tErr) throw new Error("Enregistrement échoué : " + tErr.message);

      created.push({ agent_key: key, first_name: t.first_name, role: t.role, avatar_url: pub.publicUrl });
      usage.push({
        owner: uid, company_id: null, source: "portrait", agent: key,
        provider: "google", model: img.model, images: 1, cost_usd: IMAGE_PRICE_USD,
      });
    }

    if (usage.length) await admin.from("mkt_usage").insert(usage);
    return json({ ok: true, created });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
