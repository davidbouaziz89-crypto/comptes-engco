// Marketing IA — génération de posts (agents Orchestrateur + Contenu).
// Auth : l'appelant doit être owner de la société. Secret requis : ANTHROPIC_API_KEY (déjà posé).
// Modèle surchargeable via secret MKT_MODEL (défaut claude-opus-4-8).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const POSTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          network: { type: "string", enum: ["linkedin", "instagram", "facebook"] },
          body: { type: "string", description: "Le texte du post, prêt à publier, adapté au réseau" },
          visual_idea: { type: "string", description: "Idée de visuel à créer (description concrète, 1-2 phrases)" },
          caption: { type: "string", description: "Légende courte / hashtags proposés" },
        },
        required: ["network", "body", "visual_idea", "caption"],
      },
    },
  },
  required: ["posts"],
};

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  const t = s.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* continue */ } }
  return null;
}

// Lundi de la semaine d'une date (UTC). Renvoie un objet Date à 00:00 UTC.
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0=dim..6=sam
  const diff = (dow === 0 ? -6 : 1 - dow); // ramener au lundi
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

// Répartit `perWeek` posts sur les `days` (0..6) choisis, à l'heure `hour`, dans la semaine de `weekMonday`.
function scheduleDates(weekMonday: Date, days: number[], hour: number, perWeek: number): string[] {
  const chosen = (days && days.length ? days : [1, 3, 5]).slice().sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < perWeek; i++) {
    const dow = chosen[i % chosen.length];              // 0=dim..6=sam
    const offset = (dow === 0 ? 7 : dow) - 1;           // lundi=0 ... dimanche=6
    const dt = new Date(weekMonday.getTime());
    dt.setUTCDate(dt.getUTCDate() + offset);
    dt.setUTCHours(hour, 0, 0, 0);
    out.push(dt.toISOString());
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const model = Deno.env.get("MKT_MODEL") || "claude-opus-4-8";
    if (!apiKey) return json({ error: "Clé IA non configurée (ANTHROPIC_API_KEY manquante)." }, 500);
    const admin = createClient(url, serviceKey);

    // 1) Auth : owner de la société ?
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const companyId = body.company_id;
    if (!companyId) return json({ error: "company_id manquant." }, 400);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, name, activity, owner").eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "Société introuvable." }, 404);
    if (company.owner !== uid) return json({ error: "Accès refusé à cette société." }, 403);

    // 2) Charger ligne éditoriale + cadence
    const { data: edit } = await admin.from("mkt_editorial").select("*").eq("company_id", companyId).maybeSingle();
    const { data: cadRows } = await admin.from("mkt_cadence").select("*").eq("company_id", companyId).eq("active", true);
    let cadence = (cadRows || []).filter((c: { per_week: number }) => c.per_week > 0);
    if (Array.isArray(body.networks) && body.networks.length) {
      cadence = cadence.filter((c: { network: string }) => body.networks.includes(c.network));
    }
    if (!cadence.length) return json({ error: "Aucune cadence active (>0 post/semaine) pour cette société." }, 400);

    // 3) Semaine cible
    const weekMonday = body.week_start ? mondayOf(new Date(body.week_start + "T00:00:00Z")) : mondayOf(new Date());

    // 4) Prompt (Orchestrateur décrit le besoin ; Contenu rédige)
    const totalPosts = cadence.reduce((s: number, c: { per_week: number }) => s + c.per_week, 0);
    const perNet = cadence.map((c: { network: string; per_week: number }) => `- ${c.network} : ${c.per_week} post(s)`).join("\n");
    const ed = edit || {};
    const editorialBlock = [
      ed.summary ? `La société : ${ed.summary}` : null,
      ed.tone ? `Ton : ${ed.tone}` : null,
      ed.audience ? `Cible : ${ed.audience}` : null,
      ed.topics ? `Thèmes à couvrir : ${ed.topics}` : null,
      ed.dos ? `À faire : ${ed.dos}` : null,
      ed.donts ? `À éviter : ${ed.donts}` : null,
      `Langue : ${ed.language || "fr"}`,
    ].filter(Boolean).join("\n");

    const instruction = `Tu es une équipe marketing pour la société « ${company.name} »${company.activity ? ` (${company.activity})` : ""}.
Rédige ${totalPosts} post(s) de réseaux sociaux pour la semaine, répartis ainsi :
${perNet}

Ligne éditoriale :
${editorialBlock}

Contraintes de rédaction :
- Adapte le style à chaque réseau : LinkedIn = professionnel B2B, structuré, orienté valeur/leads ; Instagram = visuel, chaleureux, hashtags ; Facebook = accessible, communautaire.
- Chaque post doit pouvoir être publié tel quel (pas de « [insérer ... ] »).
- Pour chaque post, propose aussi une idée de visuel concrète (visual_idea) et une légende courte / hashtags (caption).
- Varie les angles d'un post à l'autre, reste cohérent avec la ligne éditoriale.
Renvoie exactement ${totalPosts} post(s), en respectant la répartition par réseau demandée.`;

    // 5) Appel Claude (sortie structurée)
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        output_config: { format: { type: "json_schema", schema: POSTS_SCHEMA } },
        messages: [{ role: "user", content: [{ type: "text", text: instruction }] }],
      }),
    });
    if (!resp.ok) {
      const errTxt = await resp.text();
      console.error("ANTHROPIC_HTTP_ERROR", resp.status, errTxt.slice(0, 500));
      return json({ error: "Erreur IA (" + resp.status + ") : " + errTxt.slice(0, 400) }, 502);
    }
    const out = await resp.json();
    if (out.stop_reason === "refusal") return json({ error: "Génération refusée par l'IA." }, 422);
    const textBlock = (out.content || []).find((b: { type: string }) => b.type === "text");
    const parsed = textBlock ? tryParseJson(String(textBlock.text || "")) as { posts?: unknown[] } : null;
    if (!parsed || !Array.isArray(parsed.posts)) {
      console.error("PARSE_FAIL", out.stop_reason, JSON.stringify(out.content || []).slice(0, 500));
      return json({ error: "Réponse IA illisible. Réessaie." }, 502);
    }

    // 6) Calcul des dates + insertion (une file de dates par réseau)
    const dateQueue: Record<string, string[]> = {};
    for (const c of cadence) {
      dateQueue[c.network] = scheduleDates(weekMonday, c.days, c.hour, c.per_week);
    }
    const rows = parsed.posts.map((p) => {
      const post = p as { network: string; body: string; visual_idea: string; caption: string };
      const net = ["linkedin", "instagram", "facebook"].includes(post.network) ? post.network : cadence[0].network;
      const when = (dateQueue[net] && dateQueue[net].shift()) || null;
      return {
        company_id: companyId,
        network: net,
        body: post.body || "",
        visual_idea: post.visual_idea || "",
        caption: post.caption || "",
        scheduled_at: when,
        status: "a_valider",
      };
    });
    const { data: created, error: insErr } = await admin.from("mkt_posts").insert(rows)
      .select("id, network, body, visual_idea, caption, scheduled_at, status");
    if (insErr) return json({ error: "Insertion échouée : " + insErr.message }, 500);

    return json({ ok: true, created: created || [], usage: out.usage || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
