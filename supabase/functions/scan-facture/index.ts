// =====================================================================
//  Edge Function : scan-facture  (Compta LED / comptes-engco)
//  Scan de factures par IA via GOOGLE GEMINI (palier gratuit).
//  Reçoit une image/PDF (base64) + catégories/fournisseurs connus,
//  renvoie les champs extraits (fournisseur, date, montant HT/TTC,
//  catégorie, détail, devise). Ne touche pas à la base : le front valide.
//
//  Déploiement :
//    supabase functions deploy scan-facture --project-ref lrslisyydbiejqzpsoxc --no-verify-jwt
//  Secret requis (clé GRATUITE sur https://aistudio.google.com/app/apikey) :
//    supabase secrets set GEMINI_API_KEY=AIza... --project-ref lrslisyydbiejqzpsoxc
// =====================================================================

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MODEL = "gemini-2.5-flash"; // vision + JSON structuré, palier gratuit

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY non configurée (supabase secrets set GEMINI_API_KEY=...)" }, 500);
    const { image_b64, mime, categories, fournisseurs } = await req.json();
    if (!image_b64) return json({ error: "image_b64 manquant" }, 400);

    const catList = (categories ?? []).join(", ");
    const fourList = (fournisseurs ?? []).join(", ");

    const prompt =
      "Tu es un assistant comptable. Extrais les champs de cette facture française et renvoie UNIQUEMENT le JSON demandé.\n" +
      "- montant_ht = montant HORS TAXES (nombre, point décimal). montant_ttc = TTC.\n" +
      "- date au format AAAA-MM-JJ.\n" +
      "- devise : code ISO (EUR, ILS...).\n" +
      (fourList ? `- fournisseur : réutilise EXACTEMENT un existant si proche. Existants : ${fourList}.\n` : "") +
      (catList ? `- categorie : de préférence parmi : ${catList}. Sinon la plus adaptée.\n` : "") +
      "- detail : court objet de la facture (n° facture / prestation).\n" +
      "- confidence : 0 à 1. N'invente rien : champ illisible = vide + confiance basse.";

    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: mime || "image/jpeg", data: image_b64 } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            fournisseur: { type: "STRING" },
            date: { type: "STRING" },
            montant_ht: { type: "NUMBER" },
            montant_ttc: { type: "NUMBER" },
            devise: { type: "STRING" },
            categorie: { type: "STRING" },
            detail: { type: "STRING" },
            confidence: { type: "NUMBER" },
          },
        },
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return json({ error: `Gemini API ${resp.status}: ${await resp.text()}` }, 502);
    const result = await resp.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: "pas d'extraction retournée" }, 502);

    let extracted: any = {};
    try { extracted = JSON.parse(text); } catch { return json({ error: "réponse IA non JSON" }, 502); }
    return json({ ok: true, extracted });
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
