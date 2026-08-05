// Marketing IA — agent "Analyste de marque".
// Lit le site web d'une société, en déduit la ligne éditoriale, et l'enregistre.
// Auth : owner de la société. Secret : ANTHROPIC_API_KEY. Modèle : MKT_MODEL (défaut claude-opus-4-8).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
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

const BRAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "2-4 phrases résumant ce que fait la société, pour qui, et son positionnement — écrites pour être lues par le patron de la société." },
    tone: { type: "string", description: "Le ton de communication conseillé (ex. expert et accessible, chaleureux, direct)." },
    audience: { type: "string", description: "La ou les cibles principales (ex. dirigeants de PME, particuliers propriétaires)." },
    topics: { type: "string", description: "Liste de thèmes/sujets à aborder dans les posts, séparés par des virgules." },
    dos: { type: "string", description: "Ce qu'il faut mettre en avant / faire dans la communication." },
    donts: { type: "string", description: "Ce qu'il faut éviter." },
  },
  required: ["summary", "tone", "audience", "topics", "dos", "donts"],
};

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  const t = s.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* continue */ } }
  return null;
}

// Récupère le texte visible d'une page web (best effort, robuste aux erreurs).
async function fetchSiteText(rawUrl: string): Promise<string> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketingIA/1.0)", "Accept": "text/html" },
    });
    clearTimeout(to);
    if (!resp.ok) return "";
    let html = await resp.text();
    html = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
               .replace(/<style[\s\S]*?<\/style>/gi, " ")
               .replace(/<!--[\s\S]*?-->/g, " ");
    // Récupère le contenu des balises meta description/og en plus du texte
    const metas: string[] = [];
    const mRe = /<meta[^>]+(?:name|property)=["'](?:description|og:title|og:description)["'][^>]+content=["']([^"']+)["']/gi;
    let mm; while ((mm = mRe.exec(html)) !== null) metas.push(mm[1]);
    const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleM ? titleM[1] : "";
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const combined = [title, metas.join(" "), text].filter(Boolean).join("\n");
    return combined.slice(0, 15000);
  } catch (_e) {
    return "";
  }
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
      .select("id, name, activity, website, owner").eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "Société introuvable." }, 404);
    if (company.owner !== uid) return json({ error: "Accès refusé à cette société." }, 403);

    const websiteUrl = (body.website || company.website || "").toString().trim();

    // 2) Lecture du site (best effort)
    let siteText = "";
    if (websiteUrl) siteText = await fetchSiteText(websiteUrl);

    // 3) Prompt de l'agent Analyste de marque
    const context = siteText
      ? `Voici le contenu extrait du site web de la société (${websiteUrl}) :\n"""\n${siteText}\n"""`
      : `Le site web n'a pas pu être lu automatiquement${websiteUrl ? ` (${websiteUrl})` : " (aucun site fourni)"}. Déduis ce que tu peux à partir du nom de la société et de son activité, et reste prudent.`;

    const instruction = `Tu es l'agent "Analyste de marque" d'une équipe marketing.
Société : « ${company.name} »${company.activity ? ` — activité déclarée : ${company.activity}` : ""}.
${context}

Ta mission : comprendre cette marque pour préparer sa communication sur les réseaux sociaux.
Produis une ligne éditoriale complète en français : un résumé clair (summary) de ce que fait la société et pour qui, le ton conseillé (tone), la ou les cibles (audience), les thèmes à aborder (topics), ce qu'il faut mettre en avant (dos) et ce qu'il faut éviter (donts).
Sois concret et fidèle à ce que tu as lu. N'invente pas de faits précis (prix, chiffres) absents du site.`;

    // 4) Appel Claude
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        output_config: { format: { type: "json_schema", schema: BRAND_SCHEMA } },
        messages: [{ role: "user", content: [{ type: "text", text: instruction }] }],
      }),
    });
    if (!resp.ok) {
      const errTxt = await resp.text();
      console.error("ANTHROPIC_HTTP_ERROR", resp.status, errTxt.slice(0, 500));
      return json({ error: "Erreur IA (" + resp.status + ") : " + errTxt.slice(0, 400) }, 502);
    }
    const out = await resp.json();
    const textBlock = (out.content || []).find((b: { type: string }) => b.type === "text");
    const parsed = textBlock ? tryParseJson(String(textBlock.text || "")) as Record<string, string> : null;
    if (!parsed) return json({ error: "Réponse IA illisible. Réessaie." }, 502);

    // 5) Sauvegarde de la ligne éditoriale + du site sur la société
    if (websiteUrl && websiteUrl !== company.website) {
      await admin.from("mkt_companies").update({ website: websiteUrl }).eq("id", companyId);
    }
    const editorial = {
      company_id: companyId,
      tone: parsed.tone || "",
      audience: parsed.audience || "",
      topics: parsed.topics || "",
      dos: parsed.dos || "",
      donts: parsed.donts || "",
      summary: parsed.summary || "",
      language: "fr",
      source_url: websiteUrl || null,
      analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await admin.from("mkt_editorial").upsert(editorial, { onConflict: "company_id" });
    if (upErr) return json({ error: "Sauvegarde échouée : " + upErr.message }, 500);

    await logUsage(admin, {
      owner: uid, company_id: companyId, source: "analyse", agent: "analyste",
      provider: "anthropic", model,
      input_tokens: out.usage?.input_tokens || 0,
      output_tokens: out.usage?.output_tokens || 0,
      cache_read_tokens: out.usage?.cache_read_input_tokens || 0,
      cost_usd: claudeCost(model, out.usage || null),
    });

    return json({ ok: true, editorial, site_read: !!siteText, usage: out.usage || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
