// Marketing IA — avatars en vidéo (Veo).
// Deux temps, parce qu'une génération vidéo dure plusieurs minutes :
//   POST {agent}              -> lance la génération, renvoie l'identifiant d'opération
//   POST {agent, check:true}  -> vérifie ; quand c'est prêt, récupère la vidéo et la range
// La vidéo part de la photo « au repos » déjà générée : c'est bien le même personnage.
//
// Secret requis : GEMINI_API_KEY. Optionnel : MKT_VIDEO_MODEL.
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

const BASE = "https://generativelanguage.googleapis.com/v1beta";
// Veo facture à la seconde de vidéo ; le modèle « fast » suffit largement pour un avatar.
const VIDEO_PRICE_USD = 1.2;

const ACTIONS: Record<string, string> = {
  orchestrateur: "he glances at a planning board just off-camera, nods once, then looks back to camera with a confident smile",
  analyste: "she raises a magnifying glass beside her face, examines something with curiosity, then lowers it and smiles",
  redacteur: "he types a few keystrokes on a laptop just below frame, then looks up with a spark of inspiration",
  designer: "she makes a couple of strokes with a stylus on a tablet just below frame, then looks up pleased",
};

function videoPrompt(agent: string) {
  const action = ACTIONS[agent] || "the character looks around and smiles warmly at the camera";
  return "Looping character idle animation for a user interface avatar. " +
    "The character from the reference image stays centred in frame, in exactly the same 3D animated style, " +
    "same face, same outfit, same flat solid colour background. " +
    "They breathe gently, blink naturally, shift their shoulders slightly, and " + action + ". " +
    "Locked-off static camera, no camera movement, no zoom, no cuts. " +
    "The final frame matches the first frame so the clip loops seamlessly. " +
    "No text, no captions, no subtitles, no logo, no music, no speech.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const key = Deno.env.get("GEMINI_API_KEY");
    const model = Deno.env.get("MKT_VIDEO_MODEL") || "veo-3.1-fast-generate-preview";
    if (!key) return json({ error: "Clé image non configurée (GEMINI_API_KEY)." }, 500);
    const admin = createClient(url, serviceKey);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const agent = String(body.agent || "");
    if (!agent) return json({ error: "agent manquant." }, 400);

    const { data: row } = await admin.from("mkt_team")
      .select("agent_key, avatar_url, video_op").eq("owner", uid).eq("agent_key", agent).maybeSingle();
    if (!row) return json({ error: "Ce collègue n'a pas encore d'avatar. Génère d'abord les avatars." }, 400);

    // ---- Vérification d'une génération en cours ----
    if (body.check) {
      const op = row.video_op;
      if (!op) return json({ error: "Aucune génération en cours." }, 400);
      const res = await fetch(`${BASE}/${op}`, { headers: { "x-goog-api-key": key } });
      const txt = await res.text();
      if (!res.ok) {
        console.error("VEO_POLL_ERROR", res.status, txt.slice(0, 800));
        await admin.from("mkt_team").update({ video_op: null }).eq("owner", uid).eq("agent_key", agent);
        return json({ error: "Suivi impossible (" + res.status + ") : " + txt.slice(0, 200) }, 502);
      }
      const st = JSON.parse(txt);
      if (!st.done) return json({ ok: true, ready: false });

      if (st.error) {
        await admin.from("mkt_team").update({ video_op: null }).eq("owner", uid).eq("agent_key", agent);
        return json({ error: "Génération refusée : " + String(st.error.message || "").slice(0, 200) }, 502);
      }
      const uri = st?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) {
        await admin.from("mkt_team").update({ video_op: null }).eq("owner", uid).eq("agent_key", agent);
        return json({ error: "Aucune vidéo renvoyée." }, 502);
      }

      const vres = await fetch(uri, { headers: { "x-goog-api-key": key }, redirect: "follow" });
      if (!vres.ok) return json({ error: "Téléchargement impossible (" + vres.status + ")." }, 502);
      const bytes = new Uint8Array(await vres.arrayBuffer());

      const path = `team/${uid}/${agent}-video-${Date.now()}.mp4`;
      const { error: upErr } = await admin.storage.from("mkt-images")
        .upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (upErr) return json({ error: "Stockage échoué : " + upErr.message }, 500);
      const videoUrl = admin.storage.from("mkt-images").getPublicUrl(path).data.publicUrl;

      await admin.from("mkt_team")
        .update({ avatar_video_url: videoUrl, video_op: null, updated_at: new Date().toISOString() })
        .eq("owner", uid).eq("agent_key", agent);
      await admin.from("mkt_usage").insert({
        owner: uid, source: "video", agent, provider: "google", model, images: 1, cost_usd: VIDEO_PRICE_USD,
      });

      return json({ ok: true, ready: true, video_url: videoUrl });
    }

    // ---- Lancement d'une génération ----
    if (!row.avatar_url) return json({ error: "Portrait manquant : génère d'abord les avatars." }, 400);
    const imgRes = await fetch(row.avatar_url);
    if (!imgRes.ok) return json({ error: "Portrait illisible." }, 502);
    const mime = imgRes.headers.get("content-type") || "image/png";
    const b64 = encodeBase64(new Uint8Array(await imgRes.arrayBuffer()));

    // Veo refuse `numberOfVideos` et `inlineData` : on essaie les combinaisons
    // connues, de la plus riche à la plus dépouillée, et on garde la PREMIÈRE
    // erreur (la plus parlante) plutôt que la dernière.
    const variants: { image: unknown; parameters?: unknown }[] = [
      { image: { bytesBase64Encoded: b64, mimeType: mime }, parameters: { resolution: "720p" } },
      { image: { bytesBase64Encoded: b64, mimeType: mime } },
      { image: { imageBytes: b64, mimeType: mime } },
      { image: { inlineData: { mimeType: mime, data: b64 } } },
    ];

    let started: { name?: string } | null = null, firstErr = "";
    outer:
    for (const m of [model, "veo-3.1-generate-preview"]) {
      for (const v of variants) {
        const payload: Record<string, unknown> = {
          instances: [{ prompt: videoPrompt(agent), image: v.image }],
        };
        if (v.parameters) payload.parameters = v.parameters;
        const res = await fetch(`${BASE}/models/${m}:predictLongRunning`, {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const txt = await res.text();
        if (res.ok) { started = JSON.parse(txt); break outer; }
        if (!firstErr) firstErr = txt;
        console.error("VEO_START_ERROR", m, res.status, txt.slice(0, 800));
        if (res.status === 400) continue;          // réglage refusé : variante suivante
        if (res.status === 404) break;             // modèle inconnu : modèle suivant
        if (res.status === 429) return json({ error: "Quota vidéo Google atteint. Vérifie ta facturation." }, 502);
        return json({ error: "Lancement impossible (" + res.status + ") : " + txt.slice(0, 200) }, 502);
      }
    }
    if (!started?.name) return json({ error: "Lancement impossible : " + firstErr.slice(0, 300) }, 502);

    await admin.from("mkt_team").update({ video_op: started.name }).eq("owner", uid).eq("agent_key", agent);
    return json({ ok: true, ready: false, operation: started.name });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
