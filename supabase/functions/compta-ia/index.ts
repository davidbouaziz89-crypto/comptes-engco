// Edge function : lecture IA des documents compta (relevés PDF/image + factures).
// Appelle Claude (Opus 4.8) avec sortie structurée. Réservée aux utilisateurs
// ayant accès à la société. Secret requis : ANTHROPIC_API_KEY.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// ---- Schémas de sortie structurée ----
const RELEVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          op_date: { type: "string", description: "Date de l'opération au format AAAA-MM-JJ" },
          label: { type: "string", description: "Libellé de l'opération tel qu'il apparaît" },
          amount: { type: "number", description: "Montant signé : négatif pour un débit/sortie, positif pour un crédit/entrée" },
          counterparty: { type: ["string", "null"], description: "Nom du client ou fournisseur si identifiable, sinon null" },
          suggested_category_id: { type: ["string", "null"], description: "id d'une des catégories fournies qui correspond le mieux, ou null si incertain" },
          vat_rate: { type: ["number", "null"], description: "Taux de TVA probable en % (20, 10, 5.5, 0) ou null" },
        },
        required: ["op_date", "label", "amount", "counterparty", "suggested_category_id", "vat_rate"],
      },
    },
  },
  required: ["lines"],
};

const FACTURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    direction: { type: "string", enum: ["achat", "vente"], description: "achat = facture fournisseur, vente = facture client" },
    counterparty: { type: ["string", "null"], description: "Fournisseur (achat) ou client (vente)" },
    invoice_number: { type: ["string", "null"] },
    invoice_date: { type: ["string", "null"], description: "AAAA-MM-JJ" },
    amount_ht: { type: ["number", "null"] },
    vat_rate: { type: ["number", "null"], description: "Taux de TVA en %" },
    vat_amount: { type: ["number", "null"] },
    amount_ttc: { type: ["number", "null"] },
    is_restaurant: { type: ["boolean", "null"], description: "true si c'est une note de restaurant / repas" },
    meals: { type: ["integer", "null"], description: "Nombre de couverts/repas (personnes) si c'est un restaurant, sinon null" },
    guests: { type: ["string", "null"], description: "Noms des convives si mentionnés sur la note de restaurant, sinon null" },
  },
  required: ["direction", "counterparty", "invoice_number", "invoice_date", "amount_ht", "vat_rate", "vat_amount", "amount_ttc", "is_restaurant", "meals", "guests"],
};

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  let t = s.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
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
    console.log("compta-ia invoked; apiKey present:", !!apiKey);
    if (!apiKey) return json({ error: "Clé IA non configurée (ANTHROPIC_API_KEY manquante)." }, 500);
    const admin = createClient(url, serviceKey);

    // 1) Auth : l'appelant doit avoir accès à la société
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);
    const uid = userData.user.id;

    const body = await req.json();
    const kind = body.kind; // 'releve' | 'facture'
    const companyId = body.company_id;
    const mime = body.mime || "application/pdf";
    const dataB64 = body.data; // base64 sans préfixe data:
    const categories = Array.isArray(body.categories) ? body.categories : [];
    if (!companyId || !dataB64 || (kind !== "releve" && kind !== "facture"))
      return json({ error: "Paramètres invalides." }, 400);

    const { data: mems } = await admin.from("app_memberships").select("role").eq("user_id", uid);
    const isAdmin = (mems || []).some((m: { role: string }) => m.role === "admin");
    if (!isAdmin) {
      const { data: acc } = await admin.from("compta_company_access")
        .select("id").eq("user_id", uid).eq("company_id", companyId).maybeSingle();
      if (!acc) return json({ error: "Accès refusé à cette société." }, 403);
    }

    // 2) Construction du prompt
    const catList = categories.map((c: { id: string; name: string; flow?: string }) =>
      `- ${c.name} (id: ${c.id}${c.flow ? ", flux: " + c.flow : ""})`).join("\n") || "(aucune catégorie fournie)";

    const isImage = mime.startsWith("image/");
    const docBlock = isImage
      ? { type: "image", source: { type: "base64", media_type: mime, data: dataB64 } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: dataB64 } };

    const instruction = kind === "releve"
      ? `Tu es un assistant comptable. Analyse ce relevé bancaire et extrais TOUTES les lignes d'opérations.
Pour chaque ligne : date (AAAA-MM-JJ), libellé exact, montant signé (négatif = débit/sortie, positif = crédit/entrée).
Si tu identifies clairement le client/fournisseur, indique-le dans counterparty, sinon null.
Propose la catégorie la plus adaptée parmi cette liste (utilise son id exact), ou null si tu n'es pas sûr :
${catList}
N'invente aucune ligne. Ne renvoie que ce qui figure réellement sur le relevé.`
      : `Tu es un assistant comptable. Analyse cette facture et extrais : le sens (achat = facture reçue d'un fournisseur / vente = facture émise à un client), le tiers (fournisseur ou client), le numéro de facture, la date (AAAA-MM-JJ), le montant HT, le taux de TVA (%), le montant de TVA et le montant TTC. Mets null pour tout champ absent. Calcule les montants manquants si c'est déductible des autres.
Si le document est une note/addition de RESTAURANT ou de repas : mets is_restaurant=true, et indique dans meals le nombre de couverts/repas (nombre de personnes servies, déductible si visible sur la note : couverts, menus, cafés…), et dans guests les noms des convives s'ils sont écrits. Sinon is_restaurant=false et meals/guests à null.`;

    const schema = kind === "releve" ? RELEVE_SCHEMA : FACTURE_SCHEMA;

    // 3) Appel Claude
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 16000,
        output_config: { format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: [docBlock, { type: "text", text: instruction }] }],
      }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      console.error("ANTHROPIC_HTTP_ERROR", resp.status, errTxt.slice(0, 500));
      return json({ error: "Erreur IA (" + resp.status + ") : " + errTxt.slice(0, 400) }, 502);
    }
    const out = await resp.json();
    console.log("anthropic stop_reason=", out.stop_reason, "usage=", JSON.stringify(out.usage || {}));
    if (out.stop_reason === "refusal") return json({ error: "Document refusé par l'IA." }, 422);
    const textBlock = (out.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) { console.error("NO_TEXT_BLOCK", JSON.stringify(out.content || [])); return json({ error: "Réponse IA vide." }, 502); }

    const raw = String(textBlock.text || "");
    const parsed = tryParseJson(raw);
    if (parsed == null) {
      console.error("PARSE_FAIL stop_reason=", out.stop_reason, "len=", raw.length, "preview=", raw.slice(0, 500));
      const hint = out.stop_reason === "max_tokens"
        ? "Le document est trop long : la lecture a été coupée. Essaie un relevé plus court (par mois)."
        : "Réponse IA illisible (format inattendu). Réessaie ; si ça persiste, je corrige le format.";
      return json({ error: hint, stop_reason: out.stop_reason }, 502);
    }
    return json({ ok: true, kind, result: parsed, usage: out.usage || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
