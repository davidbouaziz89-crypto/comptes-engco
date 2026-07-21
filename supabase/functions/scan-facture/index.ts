// =====================================================================
//  Edge Function : scan-facture  (Compta LED / comptes-engco)
//  Reçoit une image/PDF de facture (base64) + la liste des catégories et
//  fournisseurs connus, l'envoie à Claude (vision) et renvoie les champs
//  extraits (fournisseur, date, montant HT/TTC, catégorie, détail, devise).
//  Ne touche PAS à la base : c'est le front qui affiche/valide puis insère.
//
//  Déploiement :
//    supabase functions deploy scan-facture --no-verify-jwt
//  Secret requis :
//    supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// =====================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-5"; // bon rapport qualité/prix pour la vision

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { image_b64, mime, categories, fournisseurs } = await req.json();
    if (!image_b64) return json({ error: "image_b64 manquant" }, 400);

    const isPdf = (mime ?? "").includes("pdf");
    const source = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: image_b64 } }
      : { type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: image_b64 } };

    const catList = (categories ?? []).join(", ");
    const fourList = (fournisseurs ?? []).join(", ");

    const body = {
      model: MODEL,
      max_tokens: 1024,
      tools: [{
        name: "enregistrer_frais",
        description: "Enregistre les champs d'un frais/dépense extraits d'une facture.",
        input_schema: {
          type: "object",
          properties: {
            fournisseur: { type: "string", description: `Nom du fournisseur/émetteur. Si proche d'un existant, réutilise-le exactement. Existants : ${fourList || "(aucun)"}` },
            date: { type: "string", description: "Date de la facture, format AAAA-MM-JJ" },
            montant_ht: { type: "number", description: "Montant HORS TAXES (nombre décimal, point séparateur)" },
            montant_ttc: { type: "number", description: "Montant TTC" },
            devise: { type: "string", description: "Code ISO, ex EUR ou ILS" },
            categorie: { type: "string", description: `Catégorie de dépense, de préférence parmi : ${catList || "(aucune définie)"}. Sinon propose la plus adaptée.` },
            detail: { type: "string", description: "Court libellé/objet de la facture (ex. n° facture, prestation)" },
            confidence: { type: "number", description: "Confiance globale 0 à 1" },
          },
          required: ["confidence"],
        },
      }],
      tool_choice: { type: "tool", name: "enregistrer_frais" },
      messages: [{
        role: "user",
        content: [
          source,
          { type: "text", text: "Extrais les champs comptables de cette facture. Privilégie le montant HORS TAXES pour montant_ht. N'invente rien : si un champ est illisible, laisse-le vide et baisse la confiance." },
        ],
      }],
    };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return json({ error: `Claude API ${resp.status}: ${await resp.text()}` }, 502);
    const result = await resp.json();
    const toolUse = result.content?.find((c: any) => c.type === "tool_use");
    if (!toolUse) return json({ error: "pas d'extraction retournée" }, 502);

    return json({ ok: true, extracted: toolUse.input });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
