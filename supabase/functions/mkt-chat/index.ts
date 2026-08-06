// Marketing IA — discussion avec l'équipe d'agents.
// Marc (chef de projet) répond, et fait entrer le bon collègue dans la conversation
// quand la question relève de son métier.
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

// Tarifs Claude en dollars par million de tokens (source : tarifs publics Anthropic).
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

// L'équipe : des collègues avec un prénom, pas des robots numérotés.
const TEAM: Record<string, { name: string; role: string; persona: string }> = {
  orchestrateur: {
    name: "Marc", role: "Chef de projet marketing",
    persona: "Tu pilotes l'équipe et la stratégie : planning de publication, priorités, cohérence d'ensemble, résultats. Tu es direct, concret, orienté décision.",
  },
  analyste: {
    name: "Léa", role: "Analyste de marque",
    persona: "Tu connais la marque, son positionnement, sa cible et ses concurrents. Tu réponds sur l'identité, le discours, la cible et le marché.",
  },
  redacteur: {
    name: "Pierre", role: "Responsable marketing & rédaction",
    persona: "Tu écris les posts et tu maîtrises les codes de chaque réseau (LinkedIn, Instagram, Facebook), les accroches, les hashtags et le calendrier éditorial.",
  },
  designer: {
    name: "Nina", role: "Directrice artistique",
    persona: "Tu conçois les visuels : styles, couleurs, compositions, cohérence graphique de la marque. Tu réponds sur tout ce qui est image et identité visuelle.",
  },
};

const ROUTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string", description: "Ta réponse à David, en français, naturelle et concrète." },
    invite: {
      type: "string",
      enum: ["", "analyste", "redacteur", "designer"],
      description: "La clé du collègue à faire intervenir si la question relève de son métier, sinon chaîne vide.",
    },
    invite_reason: {
      type: "string",
      description: "En une phrase, pourquoi ce collègue (vide si aucune invitation).",
    },
  },
  required: ["message", "invite", "invite_reason"],
};

const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string", description: "Ta réponse à David, en français." },
    info_request: { type: "string", description: "Une information sur la société qui te manque pour bien travailler, formulée en question courte. Vide si tu n'as besoin de rien." },
  },
  required: ["message", "info_request"],
};

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  const t = s.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* continue */ } }
  return null;
}

async function askClaude(apiKey: string, model: string, system: string, messages: unknown[], schema: unknown) {
  const payload = {
    max_tokens: 3000,
    system,
    output_config: { format: { type: "json_schema", schema } },
    messages,
  };
  for (const m of [model, "claude-opus-4-8"]) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: m, ...payload }),
    });
    if (resp.ok) {
      const out = await resp.json();
      return { out, usedModel: m };
    }
    const txt = await resp.text();
    console.error("ANTHROPIC_ERROR", m, resp.status, txt.slice(0, 300));
    if (m === "claude-opus-4-8" || (resp.status !== 404 && resp.status !== 400)) {
      throw new Error("Erreur IA (" + resp.status + ") : " + txt.slice(0, 200));
    }
  }
  throw new Error("Modèle IA indisponible.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const model = Deno.env.get("MKT_CHAT_MODEL") || "claude-opus-5";
    if (!apiKey) return json({ error: "Clé IA non configurée (ANTHROPIC_API_KEY manquante)." }, 500);
    const admin = createClient(url, serviceKey);

    // 1) Auth
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const companyId = body.company_id;
    const question = String(body.message || "").trim();
    if (!companyId) return json({ error: "company_id manquant." }, 400);
    if (!question) return json({ error: "Message vide." }, 400);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, name, activity, website, owner, logo_url").eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "Société introuvable." }, 404);
    if (company.owner !== uid) return json({ error: "Accès refusé à cette société." }, 403);

    // 2) Discussion (créée à la volée si besoin)
    let chatId = body.chat_id as string | undefined;
    let participants: string[] = ["orchestrateur"];
    if (chatId) {
      const { data: chat } = await admin.from("mkt_chats").select("id, owner, participants").eq("id", chatId).maybeSingle();
      if (!chat || chat.owner !== uid) return json({ error: "Discussion introuvable." }, 404);
      participants = chat.participants || ["orchestrateur"];
    } else {
      const { data: chat, error: cErr } = await admin.from("mkt_chats")
        .insert({ owner: uid, company_id: companyId, title: question.slice(0, 80) })
        .select("id, participants").single();
      if (cErr) return json({ error: "Création de la discussion échouée : " + cErr.message }, 500);
      chatId = chat.id;
      participants = chat.participants || ["orchestrateur"];
    }

    // 3) Contexte : la marque et l'état réel des posts
    const { data: edit } = await admin.from("mkt_editorial").select("*").eq("company_id", companyId).maybeSingle();
    const { data: cad } = await admin.from("mkt_cadence").select("network, per_week, active").eq("company_id", companyId);
    const { data: posts } = await admin.from("mkt_posts")
      .select("network, status, image_status, scheduled_at").eq("company_id", companyId);

    const ed = edit || {};
    const byStatus: Record<string, number> = {};
    (posts || []).forEach((p: { status: string }) => { byStatus[p.status] = (byStatus[p.status] || 0) + 1; });
    const withImage = (posts || []).filter((p: { image_status: string }) => p.image_status === "ready").length;

    const context = [
      `Société : ${company.name}${company.activity ? " — " + company.activity : ""}${company.website ? " (" + company.website + ")" : ""}`,
      ed.summary ? `Ce que l'équipe a compris de la marque : ${ed.summary}` : null,
      ed.tone ? `Ton : ${ed.tone}` : null,
      ed.audience ? `Cible : ${ed.audience}` : null,
      ed.topics ? `Thèmes : ${ed.topics}` : null,
      ed.brand_colors ? `Couleurs de la marque : ${ed.brand_colors}` : null,
      company.logo_url ? "Logo : déjà fourni par David et incrusté automatiquement sur chaque visuel — ne le redemande pas." : "Logo : absent, tu peux le demander.",
      (cad || []).length
        ? `Rythme de publication : ${(cad || []).filter((c: { active: boolean }) => c.active).map((c: { network: string; per_week: number }) => `${c.network} ${c.per_week}/sem`).join(", ") || "aucun réseau actif"}`
        : null,
      `Posts en base : ${(posts || []).length} au total (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "aucun"}), ${withImage} avec visuel.`,
    ].filter(Boolean).join("\n") + await factsBlock(admin, companyId);

    const teamList = Object.entries(TEAM)
      .map(([k, t]) => `- ${t.name} (${t.role}) — clé « ${k} » : ${t.persona}`).join("\n");

    // 4) Historique de la discussion
    const { data: past } = await admin.from("mkt_messages")
      .select("role, agent, content").eq("chat_id", chatId).order("created_at").limit(40);

    const history = (past || [])
      .filter((m: { role: string }) => m.role !== "system")
      .map((m: { role: string; agent: string | null; content: string }) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: [{
          type: "text",
          text: m.role === "user" ? m.content : `[${TEAM[m.agent || "orchestrateur"]?.name || "Équipe"}] ${m.content}`,
        }],
      }));

    const messagesForClaude = [...history, { role: "user", content: [{ type: "text", text: question }] }];

    // Discussion directe avec un collègue précis : pas de routage par Marc.
    const direct = body.agent && TEAM[body.agent] ? String(body.agent) : "";
    if (direct) {
      const mate = TEAM[direct];
      const soloSystem = `Tu es ${mate.name}, ${mate.role.toLowerCase()} dans l'équipe marketing de David. ${mate.persona}

Contexte réel de la société :
${context}

David te parle directement. Réponds en français, en collègue compétent : direct, concret, 2 à 6 phrases.
Appuie-toi sur les chiffres réels ci-dessus plutôt que d'inventer. Ne promets pas de publication automatique sur les réseaux, ce n'est pas encore en place.
S'il te manque une information sur la société pour bien faire ton métier, pose-la dans « info_request » : elle sera posée à David dans l'onglet Paramétrage. Une seule question, et seulement si elle est vraiment utile.`;

      const solo = await askClaude(apiKey, model, soloSystem, messagesForClaude, REPLY_SCHEMA);
      const stb = (solo.out.content || []).find((b: { type: string }) => b.type === "text");
      const ans = stb ? tryParseJson(String(stb.text || "")) as { message?: string; info_request?: string } : null;
      if (!ans?.message) return json({ error: "Réponse illisible. Réessaie." }, 502);
      if (ans.info_request) await askFact(admin, companyId, ans.info_request, direct);

      if (!participants.includes(direct)) participants = [...participants, direct];
      const rows = [
        { role: "user", agent: null, content: question, chat_id: chatId },
        { role: "agent", agent: direct, content: ans.message, chat_id: chatId },
      ];
      const { data: ins } = await admin.from("mkt_messages").insert(rows)
        .select("id, role, agent, content, created_at");
      await admin.from("mkt_chats")
        .update({ participants, updated_at: new Date().toISOString() }).eq("id", chatId);
      await admin.from("mkt_usage").insert({
        owner: uid, company_id: companyId, source: "discussion", agent: direct,
        provider: "anthropic", model: solo.usedModel,
        input_tokens: solo.out.usage?.input_tokens || 0,
        output_tokens: solo.out.usage?.output_tokens || 0,
        cache_read_tokens: solo.out.usage?.cache_read_input_tokens || 0,
        cost_usd: claudeCost(solo.usedModel, solo.out.usage || null),
      });
      return json({ ok: true, chat_id: chatId, participants, messages: ins || [] });
    }

    const marc = TEAM.orchestrateur;
    const routerSystem = `Tu es ${marc.name}, ${marc.role.toLowerCase()} de l'équipe marketing de David. ${marc.persona}

Ton équipe :
${teamList}

Contexte réel de la société dont vous vous occupez :
${context}

Règles :
- Réponds toujours en français, sur un ton de collègue compétent : direct, concret, sans jargon inutile ni flatterie.
- Reste court : 2 à 6 phrases, sauf si David demande explicitement du détail.
- Si la question relève clairement du métier d'un collègue, renseigne « invite » avec sa clé. Dans ce cas ton message annonce simplement que tu le fais entrer dans la conversation, sans répondre à sa place.
- Si tu peux répondre toi-même (planning, priorités, stratégie, état d'avancement), laisse « invite » vide.
- Ne promets jamais une action que le logiciel ne sait pas faire. Aujourd'hui l'app sait : analyser un site, écrire des posts, créer des visuels, valider/refuser. Elle ne publie pas encore automatiquement sur les réseaux.
- Appuie-toi sur les chiffres réels du contexte ci-dessus plutôt que d'inventer.`;


    const { out, usedModel } = await askClaude(apiKey, model, routerSystem, messagesForClaude, ROUTER_SCHEMA);
    if (out.stop_reason === "refusal") return json({ error: "Réponse refusée par l'IA." }, 422);
    const tb = (out.content || []).find((b: { type: string }) => b.type === "text");
    const routed = tb ? tryParseJson(String(tb.text || "")) as { message?: string; invite?: string; invite_reason?: string } : null;
    if (!routed || !routed.message) return json({ error: "Réponse illisible. Réessaie." }, 502);

    const usageRows: Record<string, unknown>[] = [{
      owner: uid, company_id: companyId, source: "discussion", agent: "orchestrateur",
      provider: "anthropic", model: usedModel,
      input_tokens: out.usage?.input_tokens || 0,
      output_tokens: out.usage?.output_tokens || 0,
      cache_read_tokens: out.usage?.cache_read_input_tokens || 0,
      cost_usd: claudeCost(usedModel, out.usage || null),
    }];

    // 5) Messages à enregistrer
    const newMessages: { role: string; agent: string | null; content: string }[] = [
      { role: "user", agent: null, content: question },
      { role: "agent", agent: "orchestrateur", content: routed.message },
    ];

    const inviteKey = routed.invite && TEAM[routed.invite] ? routed.invite : "";
    if (inviteKey) {
      const mate = TEAM[inviteKey];
      if (!participants.includes(inviteKey)) participants = [...participants, inviteKey];
      newMessages.push({
        role: "system", agent: inviteKey,
        content: `${mate.name} (${mate.role}) rejoint la conversation${routed.invite_reason ? " — " + routed.invite_reason : ""}`,
      });

      const mateSystem = `Tu es ${mate.name}, ${mate.role.toLowerCase()} dans l'équipe marketing de David. ${mate.persona}

Contexte réel de la société :
${context}

${marc.name}, le chef de projet, vient de te faire entrer dans la conversation${routed.invite_reason ? " : " + routed.invite_reason : ""}.
Réponds directement à David, en français, sur un ton de collègue compétent. 2 à 8 phrases, concret et actionnable. Ne te présente pas longuement : une demi-phrase suffit. Ne promets pas de publication automatique sur les réseaux, ce n'est pas encore en place.`;

      const mateRes = await askClaude(apiKey, model, mateSystem, messagesForClaude, REPLY_SCHEMA);
      const mtb = (mateRes.out.content || []).find((b: { type: string }) => b.type === "text");
      const mateAns = mtb ? tryParseJson(String(mtb.text || "")) as { message?: string; info_request?: string } : null;
      if (mateAns?.info_request) await askFact(admin, companyId, mateAns.info_request, inviteKey);
      if (mateAns?.message) {
        newMessages.push({ role: "agent", agent: inviteKey, content: mateAns.message });
        usageRows.push({
          owner: uid, company_id: companyId, source: "discussion", agent: inviteKey,
          provider: "anthropic", model: mateRes.usedModel,
          input_tokens: mateRes.out.usage?.input_tokens || 0,
          output_tokens: mateRes.out.usage?.output_tokens || 0,
          cache_read_tokens: mateRes.out.usage?.cache_read_input_tokens || 0,
          cost_usd: claudeCost(mateRes.usedModel, mateRes.out.usage || null),
        });
      }
    }

    const { data: inserted, error: mErr } = await admin.from("mkt_messages")
      .insert(newMessages.map((m) => ({ ...m, chat_id: chatId })))
      .select("id, role, agent, content, created_at");
    if (mErr) return json({ error: "Enregistrement échoué : " + mErr.message }, 500);

    await admin.from("mkt_chats")
      .update({ participants, updated_at: new Date().toISOString() }).eq("id", chatId);
    await admin.from("mkt_usage").insert(usageRows);

    const cost = usageRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    return json({ ok: true, chat_id: chatId, participants, messages: inserted || [], cost_usd: cost });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
