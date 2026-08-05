// Marketing IA — avatars animés de l'équipe.
// Pour chaque collègue on génère 3 images en style 3D animé :
//   1) au repos   2) au travail (pose A)   3) au travail (pose B)
// Les poses 2 et 3 sont générées EN PARTANT de l'image 1 (référence visuelle),
// pour que ce soit bien le même personnage d'une image à l'autre.
// Les 2 poses de travail s'alternent dans l'app : l'agent bouge et agit.
//
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

const IMAGE_PRICE_USD = 0.04;

const QUOTA_MSG =
  "Quota Google épuisé. Vérifie la facturation de ton projet Google AI Studio " +
  "(https://aistudio.google.com/apikey) ou attends la remise à zéro.";

// Le style, identique pour toute l'équipe : c'est lui qui fait la cohérence.
const STYLE =
  "3D animated character in the style of a modern computer-animated feature film: stylized proportions, " +
  "large expressive eyes, soft rounded features, smooth subsurface-scattering skin, clean soft studio lighting " +
  "with a gentle rim light. Completely flat solid single-colour background, no gradient, no scenery. " +
  "Facing the camera, warm friendly smile, appealing and likeable. High-quality polished 3D render, crisp clean edges. " +
  "No text, no watermark, no logo, no border.";

const TEAM: Record<string, {
  first_name: string; role: string; bg: string; look: string; work1: string; work2: string;
}> = {
  orchestrateur: {
    first_name: "Marc", role: "Chef de projet marketing",
    bg: "flat soft cornflower blue",
    look: "A friendly man in his late thirties, thick dark brown hair swept up and back, neatly trimmed short beard, warm brown eyes, wearing a navy blue blazer over a crisp white shirt with an open collar.",
    work1: "he is holding a tablet in one hand and pointing at a floating planning board with the other, explaining the week ahead, upper body visible, hands clearly visible",
    work2: "he is leaning slightly forward with both hands open in a presenting gesture, mid-sentence, upper body visible, hands clearly visible",
  },
  analyste: {
    first_name: "Léa", role: "Analyste de marque",
    bg: "flat warm coral pink",
    look: "A friendly woman in her early thirties, shoulder-length wavy chestnut brown hair, small gold hoop earrings and a delicate gold pendant necklace, warm brown eyes, wearing a beige blazer over a white top.",
    work1: "she is holding a large magnifying glass up beside her face, studying something carefully with curiosity, upper body visible, hands clearly visible",
    work2: "she is holding a sheet of paper in one hand and tapping her chin thoughtfully with the other, analysing, upper body visible, hands clearly visible",
  },
  redacteur: {
    first_name: "Pierre", role: "Responsable marketing & rédaction",
    bg: "flat soft mint green",
    look: "A friendly man in his early thirties, curly dark brown hair, round black-rimmed glasses, clean shaven, warm brown eyes, wearing a forest green crew-neck sweater over a white collared shirt.",
    work1: "he is typing enthusiastically on a laptop, hands on the keyboard, focused and happy, upper body visible, hands clearly visible",
    work2: "he is writing in a notebook with a pen, looking up with a spark of inspiration, upper body visible, hands clearly visible",
  },
  designer: {
    first_name: "Nina", role: "Directrice artistique",
    bg: "flat soft lavender purple",
    look: "A stylish woman with a silver-grey chin-length bob, bold black-rimmed glasses, small gold earrings, warm brown eyes, wearing a dark navy blazer over a white top.",
    work1: "she is drawing on a graphics tablet with a stylus, concentrating on her artwork, upper body visible, hands clearly visible",
    work2: "she is holding up a colour swatch fan and comparing shades, pleased with the result, upper body visible, hands clearly visible",
  },
};

function imageConfigs() {
  return [
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
    { responseModalities: ["IMAGE"], responseFormat: { image: { aspectRatio: "1:1" } } },
    { responseModalities: ["IMAGE"] },
  ];
}

// Génère une image. `ref` (base64) sert de référence visuelle pour garder le même personnage.
async function generateImage(
  apiKey: string, model: string, prompt: string,
  ref?: { data: string; mime: string },
) {
  const parts: unknown[] = [];
  if (ref) parts.push({ inline_data: { mime_type: ref.mime, data: ref.data } });
  parts.push({ text: prompt });

  let lastErr = "", quota = false;
  for (const m of [model, "gemini-2.5-flash-image"]) {
    for (const generationConfig of imageConfigs()) {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1/models/${m}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], generationConfig }),
      });
      if (resp.ok) {
        const gem = await resp.json();
        const rparts = gem?.candidates?.[0]?.content?.parts || [];
        const inline = rparts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data)?.inlineData;
        if (!inline?.data) {
          const reason = gem?.candidates?.[0]?.finishReason || gem?.promptFeedback?.blockReason || "aucune image renvoyée";
          throw new Error("Image non générée (" + reason + ").");
        }
        return { data: inline.data as string, mime: (inline.mimeType as string) || "image/png", model: m };
      }
      const txt = await resp.text();
      lastErr = txt;
      console.error("GEMINI_ERROR", m, resp.status, txt.slice(0, 1200));
      if (resp.status === 400) continue;
      if (resp.status === 404) break;
      if (resp.status === 429) { quota = true; break; }
      throw new Error("Erreur image (" + resp.status + ") : " + txt.slice(0, 200));
    }
  }
  if (quota) throw new Error(QUOTA_MSG + quotaDetail(lastErr));
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
    const force = !!body.force;

    const { data: existing } = await admin.from("mkt_team").select("agent_key, avatar_url, avatar_work1_url").eq("owner", uid);
    const done = new Set((existing || [])
      .filter((r: { avatar_url: string | null; avatar_work1_url: string | null }) => r.avatar_url && r.avatar_work1_url)
      .map((r: { agent_key: string }) => r.agent_key));

    // Un seul collègue par appel : 3 images dans la même invocation suffisaient à
    // dépasser le budget de la fonction (erreur 546). Le front enchaîne les appels.
    const todo = only ? [only] : Object.keys(TEAM).filter((k) => force || !done.has(k));
    const keys = todo.slice(0, 1);
    if (!keys.length) return json({ ok: true, created: [], remaining: 0, message: "Les avatars existent déjà." });

    const created: unknown[] = [];
    const usage: Record<string, unknown>[] = [];
    const stamp = Date.now();

    const upload = async (key: string, tag: string, img: { data: string; mime: string }) => {
      const ext = img.mime.includes("jpeg") ? "jpg" : "png";
      const bytes = await b64ToBytes(img.data, img.mime);
      const path = `team/${uid}/${key}-${tag}-${stamp}.${ext}`;
      const { error } = await admin.storage.from("mkt-images")
        .upload(path, bytes, { contentType: img.mime, upsert: true });
      if (error) throw new Error("Stockage échoué : " + error.message);
      return admin.storage.from("mkt-images").getPublicUrl(path).data.publicUrl;
    };

    for (const key of keys) {
      const t = TEAM[key];
      const base = `${t.look} Background colour: ${t.bg}. Shoulders-up portrait. ${STYLE}`;

      // 1) La pose au repos sert de référence à toutes les autres.
      const idle = await generateImage(geminiKey, imageModel, base);
      const idleUrl = await upload(key, "idle", idle);
      usage.push({ owner: uid, source: "portrait", agent: key, provider: "google", model: idle.model, images: 1, cost_usd: IMAGE_PRICE_USD });

      // 2) Les deux poses de travail, dérivées de la première.
      const workUrls: (string | null)[] = [null, null];
      const actions = [t.work1, t.work2];
      for (let i = 0; i < actions.length; i++) {
        try {
          const prompt = `Keep exactly the same character as the reference image: same face, same hairstyle, same glasses, `
            + `same outfit, same flat ${t.bg} background, same 3D animated style and lighting. `
            + `Change only the pose: ${actions[i]}. ${STYLE}`;
          const w = await generateImage(geminiKey, imageModel, prompt, { data: idle.data, mime: idle.mime });
          workUrls[i] = await upload(key, "work" + (i + 1), w);
          usage.push({ owner: uid, source: "portrait", agent: key, provider: "google", model: w.model, images: 1, cost_usd: IMAGE_PRICE_USD });
        } catch (e) {
          // Une pose ratée ne doit pas faire perdre le portrait principal.
          console.error("WORK_POSE_FAIL", key, i, String((e as Error)?.message || e));
        }
      }

      const { error: tErr } = await admin.from("mkt_team").upsert({
        owner: uid, agent_key: key, first_name: t.first_name, role: t.role,
        avatar_url: idleUrl, avatar_work1_url: workUrls[0], avatar_work2_url: workUrls[1],
        updated_at: new Date().toISOString(),
      }, { onConflict: "owner,agent_key" });
      if (tErr) throw new Error("Enregistrement échoué : " + tErr.message);

      created.push({ agent_key: key, first_name: t.first_name, role: t.role, avatar_url: idleUrl });
    }

    if (usage.length) await admin.from("mkt_usage").insert(usage);
    return json({ ok: true, created, remaining: Math.max(0, todo.length - keys.length) });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
