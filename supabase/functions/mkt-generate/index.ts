// Marketing IA — génération de posts (agents Orchestrateur + Contenu).
// Auth : l'appelant doit être owner de la société. Secret requis : ANTHROPIC_API_KEY (déjà posé).
// Modèle surchargeable via secret MKT_MODEL (défaut claude-opus-5).
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
    const model = Deno.env.get("MKT_MODEL") || "claude-opus-5";
    if (!apiKey) return json({ error: "Clé IA non configurée (ANTHROPIC_API_KEY manquante)." }, 500);
    const admin = createClient(url, serviceKey);

    const body = await req.json().catch(() => ({}));

    // 1) Auth : soit l'utilisateur, soit le pilote automatique (secret côté serveur).
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const given = req.headers.get("x-cron-secret") || "";
    let uid: string;
    if (cronSecret && given === cronSecret && body.owner_id) {
      uid = String(body.owner_id);
    } else {
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      const { data: userData, error: uErr } = await admin.auth.getUser(token);
      if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
      uid = userData.user.id;
    }

    const companyId = body.company_id;
    if (!companyId) return json({ error: "company_id manquant." }, 400);

    const { data: company } = await admin.from("mkt_companies")
      .select("id, name, activity, owner").eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "Société introuvable." }, 404);
    if (company.owner !== uid) return json({ error: "Accès refusé à cette société." }, 403);

    // 2) Post à la demande : un sujet précis, hors cadence
    const sujet = String(body.topic || "").trim();
    if (sujet) {
      const reseau = ["linkedin", "instagram", "facebook"].includes(body.network) ? body.network : "linkedin";
      const quand = body.when || new Date(Date.now() + 86400000).toISOString();

      const { data: ed1 } = await admin.from("mkt_editorial").select("*").eq("company_id", companyId).maybeSingle();
      const e1 = ed1 || {};
      const bloc = [
        e1.summary ? `La société : ${e1.summary}` : null,
        e1.tone ? `Ton : ${e1.tone}` : null,
        e1.audience ? `Cible : ${e1.audience}` : null,
        e1.dos ? `À faire : ${e1.dos}` : null,
        e1.donts ? `À éviter : ${e1.donts}` : null,
      ].filter(Boolean).join("\n") + await factsBlock(admin, companyId);

      const consigne = `Tu es le responsable marketing de « ${company.name} »${company.activity ? ` (${company.activity})` : ""}.
Écris UN SEUL post ${reseau}, sur ce sujet précis demandé par David :
« ${sujet} »

Ligne éditoriale :
${bloc}

Contraintes :
- Le sujet demandé prime sur tout le reste : traite-le vraiment, ne le dilue pas.
- Adapte le style au réseau : LinkedIn = professionnel et structuré ; Instagram = visuel et chaleureux ; Facebook = accessible.
- Le post doit être publiable tel quel, sans mention à compléter.
- Propose aussi une idée de visuel concrète et une légende courte avec hashtags.
Renvoie exactement 1 post.`;

      const resp1 = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: 3000,
          output_config: { format: { type: "json_schema", schema: POSTS_SCHEMA } },
          messages: [{ role: "user", content: [{ type: "text", text: consigne }] }],
        }),
      });
      if (!resp1.ok) {
        const t = await resp1.text();
        return json({ error: "Erreur IA (" + resp1.status + ") : " + t.slice(0, 300) }, 502);
      }
      const o1 = await resp1.json();
      const tb1 = (o1.content || []).find((b: { type: string }) => b.type === "text");
      const p1 = tb1 ? tryParseJson(String(tb1.text || "")) as { posts?: Record<string, string>[] } : null;
      const un = p1 && Array.isArray(p1.posts) ? p1.posts[0] : null;
      if (!un) return json({ error: "Réponse IA illisible. Réessaie." }, 502);

      const { data: cree, error: e2 } = await admin.from("mkt_posts").insert({
        company_id: companyId, network: reseau,
        body: un.body || "", visual_idea: un.visual_idea || "", caption: un.caption || "",
        scheduled_at: quand, status: "a_valider", image_status: "none",
      }).select("id, network, body, visual_idea, caption, scheduled_at, status").single();
      if (e2) return json({ error: "Insertion échouée : " + e2.message }, 500);

      await logUsage(admin, {
        owner: uid, company_id: companyId, source: "generation", agent: "redacteur",
        provider: "anthropic", model,
        input_tokens: o1.usage?.input_tokens || 0,
        output_tokens: o1.usage?.output_tokens || 0,
        cache_read_tokens: o1.usage?.cache_read_input_tokens || 0,
        cost_usd: claudeCost(model, o1.usage || null),
      });

      return json({ ok: true, created: [cree], single: true });
    }

    // 3) Charger ligne éditoriale + cadence
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
    ].filter(Boolean).join("\n") + await factsBlock(admin, companyId);

    const instruction = `Tu es directeur de création dans une agence qui écrit pour « ${company.name} »${company.activity ? ` (${company.activity})` : ""}.
Écris ${totalPosts} post(s) pour la semaine, répartis ainsi :
${perNet}

Ligne éditoriale :
${editorialBlock}

CE QUI FAIT UN BON POST — applique-le à la lettre :

1) La première ligne décide de tout. Elle doit arrêter le pouce. Une tension, une question dérangeante, un chiffre inattendu, un aveu. Jamais « Chez ${company.name}, nous… », jamais « À l'ère du digital », jamais « Saviez-vous que ».

2) UNE seule idée par post. Pas trois conseils, pas une liste fourre-tout. Un angle, développé jusqu'au bout.

3) Du concret, toujours. Des chiffres, des durées, des prix, des situations vécues, des objections réelles de clients. Si tu n'as pas le chiffre exact, décris une scène précise plutôt que d'écrire une généralité.

4) Écris comme on parle. Phrases courtes. Verbes actifs. Tu peux commencer par « Et » ou « Mais ». Interdits : « solution innovante », « au cœur de », « accompagner nos clients », « à l'ère de », « révolutionner », « incontournable », « sur-mesure », « expertise », « synergie », « il est important de noter ».

5) Zéro emoji décoratif en début de ligne. Au maximum un ou deux dans tout le post, et seulement s'ils servent.

6) Termine par une question ouverte ou une invitation concrète, jamais par « N'hésitez pas à nous contacter ».

FORMAT PROPRE À CHAQUE RÉSEAU :
- LinkedIn : 700 à 1200 signes. Accroche sur une ligne, saut de ligne, puis le corps aéré en paragraphes de 1 à 3 lignes. Ton d'expert qui partage, pas de commercial qui vend.
- Facebook : 300 à 600 signes. Chaleureux, direct, conversationnel. On s'adresse à une personne, pas à un marché.
- Instagram : 150 à 400 signes. Rythmé, incarné. La légende (caption) porte les hashtags : 5 à 10, précis et sectoriels, jamais #business #motivation.

VISUEL (visual_idea) : décris une scène ou un objet précis, pas un concept. « Un standardiste débordé, six lignes qui clignotent » plutôt que « la communication d'entreprise ».

Varie franchement les angles d'un post à l'autre : preuve chiffrée, objection démontée, coulisses, erreur fréquente, cas client, prise de position. Deux posts ne doivent jamais se ressembler.

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

    // 5 bis) Passe de relecture. Un premier jet d'IA retombe presque toujours dans
    // le corporate mou ; c'est la réécriture sous critique qui fait la différence,
    // bien plus qu'un prompt initial plus long.
    let postsFinaux = parsed.posts;
    try {
      const relecture = `Tu es rédacteur en chef. Voici les brouillons écrits pour « ${company.name} »${company.activity ? ` (${company.activity})` : ""}.

${JSON.stringify({ posts: parsed.posts }, null, 1).slice(0, 12000)}

Ligne éditoriale :
${editorialBlock}

Passe chaque post au crible, sans complaisance :
- L'accroche arrête-t-elle vraiment le pouce, ou est-ce un début tiède ? Si elle est tiède, réécris-la entièrement.
- Reste-t-il du jargon d'entreprise, des formules creuses, des phrases qui pourraient être dans n'importe quel post de n'importe quelle société ? Supprime.
- Le post dit-il quelque chose de CONCRET, ou tourne-t-il autour du sujet sans rien affirmer ? S'il ne dit rien, réécris-le autour d'une idée nette.
- Y a-t-il deux posts qui se ressemblent ? Change l'angle de l'un des deux.
- Les longueurs sont-elles tenues (LinkedIn 700-1200 signes, Facebook 300-600, Instagram 150-400) ?
- Une phrase pourrait-elle sauter sans rien perdre ? Enlève-la.

Renvoie les ${totalPosts} post(s) réécrits, même structure, même répartition par réseau. Ne commente pas, ne justifie pas : rends le texte final.`;

      const rev = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: 8000,
          output_config: { format: { type: "json_schema", schema: POSTS_SCHEMA } },
          messages: [{ role: "user", content: [{ type: "text", text: relecture }] }],
        }),
      });
      if (rev.ok) {
        const outRev = await rev.json();
        const bRev = (outRev.content || []).find((b: { type: string }) => b.type === "text");
        const pRev = bRev ? tryParseJson(String(bRev.text || "")) as { posts?: unknown[] } : null;
        // On ne garde la relecture que si elle rend bien le compte attendu :
        // un jet incomplet ferait perdre des posts sans prévenir.
        if (pRev && Array.isArray(pRev.posts) && pRev.posts.length === parsed.posts.length) {
          postsFinaux = pRev.posts;
          await logUsage(admin, {
            owner: uid, company_id: companyId, source: "generation", agent: "redacteur_chef",
            provider: "anthropic", model: outRev.model || model,
            input_tokens: outRev.usage?.input_tokens || 0,
            output_tokens: outRev.usage?.output_tokens || 0,
            cache_read_tokens: outRev.usage?.cache_read_input_tokens || 0,
            cost_usd: claudeCost(outRev.model || model, outRev.usage || null),
          });
        }
      }
    } catch (e) { console.error("RELECTURE_FAIL", String(e)); }

    // 6) Calcul des dates + insertion (une file de dates par réseau)
    const dateQueue: Record<string, string[]> = {};
    for (const c of cadence) {
      dateQueue[c.network] = scheduleDates(weekMonday, c.days, c.hour, c.per_week);
    }
    const rows = postsFinaux.map((p) => {
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
        image_status: "none", // le Directeur artistique prendra le relais
      };
    });
    const { data: created, error: insErr } = await admin.from("mkt_posts").insert(rows)
      .select("id, network, body, visual_idea, caption, scheduled_at, status, image_status");
    if (insErr) return json({ error: "Insertion échouée : " + insErr.message }, 500);

    await logUsage(admin, {
      owner: uid, company_id: companyId, source: "generation", agent: "redacteur",
      provider: "anthropic", model,
      input_tokens: out.usage?.input_tokens || 0,
      output_tokens: out.usage?.output_tokens || 0,
      cache_read_tokens: out.usage?.cache_read_input_tokens || 0,
      cost_usd: claudeCost(model, out.usage || null),
    });

    return json({ ok: true, created: created || [], usage: out.usage || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
