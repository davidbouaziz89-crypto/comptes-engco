// Marketing IA — discuter d'un post précis avec l'agent qui s'en occupe.
// Pierre répond sur le texte, Nina sur le visuel. Et surtout : ils APPLIQUENT
// la modification demandée, ils ne se contentent pas d'en parler.
//
// Secret requis : ANTHROPIC_API_KEY. Optionnel : MKT_CHAT_MODEL.
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const PRICE: Record<string, { i: number; o: number }> = {
  "claude-opus-5": { i: 5, o: 25 }, "claude-opus-4-8": { i: 5, o: 25 },
  "claude-sonnet-5": { i: 3, o: 15 }, "claude-haiku-4-5": { i: 1, o: 5 },
};
function claudeCost(model: string, u: Record<string, number> | null) {
  const p = PRICE[model] || PRICE["claude-opus-5"];
  return ((u?.input_tokens || 0) * p.i + (u?.output_tokens || 0) * p.o
    + (u?.cache_read_input_tokens || 0) * p.i * 0.1) / 1_000_000;
}

const TEAM: Record<string, { name: string; role: string }> = {
  redacteur: { name: "Pierre", role: "Responsable marketing & rédaction" },
  designer: { name: "Nina", role: "Directrice artistique" },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    agent: { type: "string", enum: ["redacteur", "designer"], description: "Qui répond : Pierre pour le texte, Nina pour le visuel." },
    reply: { type: "string", description: "Ta réponse à David, en français, courte (1 à 4 phrases), ton de collègue. Dis ce que tu as changé." },
    action: {
      type: "string",
      enum: ["none", "update_text", "regenerate_image"],
      description: "update_text = tu réécris le post ; regenerate_image = le visuel doit être refait ; none = simple échange.",
    },
    new_body: { type: "string", description: "Le texte complet et réécrit du post, prêt à publier. Vide si action ≠ update_text." },
    image_instruction: { type: "string", description: "La consigne à ajouter au Directeur artistique, en français, précise. Vide si action ≠ regenerate_image." },
    info_request: { type: "string", description: "Une information sur la société qui te manque pour bien faire ton travail, formulée comme une question courte à David. Vide si tu n'as besoin de rien." },
  },
  required: ["agent", "reply", "action", "new_body", "image_instruction", "info_request"],
};

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  const t = s.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* continue */ } }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const model = Deno.env.get("MKT_CHAT_MODEL") || "claude-opus-5";
    if (!apiKey) return json({ error: "Clé IA non configurée." }, 500);
    const admin = createClient(url, serviceKey);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const postId = body.post_id;
    const message = String(body.message || "").trim();
    if (!postId || !message) return json({ error: "post_id ou message manquant." }, 400);

    const { data: post } = await admin.from("mkt_posts")
      .select("id, company_id, network, body, caption, visual_idea, image_headline, image_style, image_alt")
      .eq("id", postId).maybeSingle();
    if (!post) return json({ error: "Post introuvable." }, 404);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, name, activity, owner, logo_url").eq("id", post.company_id).maybeSingle();
    if (!company || company.owner !== uid) return json({ error: "Accès refusé." }, 403);

    const { data: edit } = await admin.from("mkt_editorial").select("*").eq("company_id", post.company_id).maybeSingle();
    const ed = edit || {};

    const system = `Vous êtes deux collègues de l'équipe marketing de David, en train de retoucher UN post précis.

- Pierre (Responsable marketing & rédaction) : le texte du post, l'accroche, les hashtags, l'adaptation au réseau.
- Nina (Directrice artistique) : le visuel, le style, les couleurs, l'accroche incrustée sur l'image.

Celui des deux dont c'est le métier répond. Renseigne « agent » en conséquence.

La société : ${company.name}${company.activity ? " — " + company.activity : ""}\n${company.logo_url ? "Logo : déjà fourni, incrusté automatiquement sur les visuels — ne le redemande pas." : "Logo : absent."}
${[ed.summary && "Ce que l'équipe a compris : " + ed.summary, ed.tone && "Ton : " + ed.tone, ed.audience && "Cible : " + ed.audience, ed.donts && "À éviter : " + ed.donts].filter(Boolean).join("\n")}${await factsBlock(admin, post.company_id)}

Le post concerné — réseau ${post.network} :
"""${post.body || ""}"""
Légende / hashtags : ${post.caption || "(aucune)"}
Accroche du visuel : ${post.image_headline || "(aucune)"}
Style du visuel : ${post.image_style || "(aucun)"}

Règles :
- Réponds en français, comme un collègue : direct, concret, pas de flatterie, 1 à 4 phrases.
- Si David demande une modification du TEXTE, réécris-le EN ENTIER dans « new_body » et mets action = update_text. Garde le format du réseau, ne perds ni l'appel à l'action ni les hashtags sauf demande contraire.
- Si David demande une modification du VISUEL, mets action = regenerate_image et écris dans « image_instruction » une consigne précise pour le Directeur artistique (ce qu'il faut changer : sujet, ambiance, couleurs, accroche…).
- Si c'est une simple question ou un avis, action = none.
- Ne promets jamais de publier sur les réseaux : le logiciel ne le fait pas encore.
- S'il te manque une information sur la société pour bien faire (offre, prix, références, zone d'intervention, argument différenciant…), pose la question dans « info_request ». Elle sera posée à David dans l'onglet Paramétrage. Une seule question à la fois, et seulement si elle est vraiment utile.`;

    // Une discussion par post : l'historique survit à la fermeture de la bulle.
    let chatId: string | null = null;
    {
      const { data: ex } = await admin.from("mkt_chats")
        .select("id").eq("owner", uid).eq("post_id", postId).maybeSingle();
      if (ex) chatId = ex.id;
      else {
        const { data: cr } = await admin.from("mkt_chats").insert({
          owner: uid, company_id: post.company_id, post_id: postId,
          title: `Post ${post.network} — ${(post.body || "").slice(0, 40)}`,
          participants: ["redacteur"],
        }).select("id").single();
        chatId = cr?.id || null;
      }
    }

    let history: { role: string; content: string }[] = [];
    if (chatId) {
      const { data: past } = await admin.from("mkt_messages")
        .select("role, agent, content").eq("chat_id", chatId).order("created_at").limit(24);
      history = (past || []).map((m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "assistant", content: m.content,
      }));
    }
    const messages = [
      ...history.map((m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: [{ type: "text", text: String(m.content || "") }],
      })),
      { role: "user", content: [{ type: "text", text: message }] },
    ];

    let out: Record<string, unknown> | null = null, used = model;
    for (const m of [model, "claude-opus-4-8"]) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: m, max_tokens: 3000, system,
          output_config: { format: { type: "json_schema", schema: SCHEMA } },
          messages,
        }),
      });
      if (resp.ok) { out = await resp.json(); used = m; break; }
      const txt = await resp.text();
      console.error("ANTHROPIC_ERROR", m, resp.status, txt.slice(0, 800));
      if (m === "claude-opus-4-8" || (resp.status !== 404 && resp.status !== 400)) {
        return json({ error: "Erreur IA (" + resp.status + ") : " + txt.slice(0, 200) }, 502);
      }
    }
    if (!out) return json({ error: "Modèle IA indisponible." }, 502);

    // deno-lint-ignore no-explicit-any
    const tb = ((out as any).content || []).find((b: { type: string }) => b.type === "text");
    const r = tb ? tryParseJson(String(tb.text || "")) as Record<string, string> : null;
    if (!r || !r.reply) return json({ error: "Réponse illisible. Réessaie." }, 502);

    if (r.info_request) await askFact(admin, post.company_id, r.info_request, r.agent || "redacteur");

    if (chatId) {
      await admin.from("mkt_messages").insert([
        { chat_id: chatId, role: "user", agent: null, content: message },
        { chat_id: chatId, role: "agent", agent: r.agent || "redacteur", content: r.reply },
      ]);
      await admin.from("mkt_chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
    }

    // On applique tout de suite ce qui peut l'être.
    if (r.action === "update_text" && r.new_body) {
      await admin.from("mkt_posts")
        .update({ body: r.new_body, updated_at: new Date().toISOString() }).eq("id", postId);
    }

    // deno-lint-ignore no-explicit-any
    const usage = (out as any).usage || null;
    await admin.from("mkt_usage").insert({
      owner: uid, company_id: post.company_id, source: "discussion",
      agent: TEAM[r.agent] ? r.agent : "redacteur", provider: "anthropic", model: used,
      input_tokens: usage?.input_tokens || 0, output_tokens: usage?.output_tokens || 0,
      cache_read_tokens: usage?.cache_read_input_tokens || 0,
      cost_usd: claudeCost(used, usage),
    });

    return json({
      ok: true,
      agent: TEAM[r.agent] ? r.agent : "redacteur",
      reply: r.reply,
      action: r.action || "none",
      new_body: r.new_body || "",
      image_instruction: r.image_instruction || "",
      info_request: r.info_request || "",
      chat_id: chatId,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
