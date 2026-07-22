// =====================================================================
//  Edge Function : scan-facture  (Compta LED / comptes-engco)
//  Scan de factures par IA via MISTRAL (mistral-small vision) — GRATUIT, sans carte.
//  Reçoit une image (base64) + catégories/fournisseurs connus, renvoie les
//  champs extraits (fournisseur, date, montant HT/TTC, catégorie, détail).
//  Ne touche pas à la base : le front affiche/valide puis insère.
//
//  Déploiement :
//    supabase functions deploy scan-facture --project-ref lrslisyydbiejqzpsoxc --no-verify-jwt
//  Secret requis (clé GRATUITE sans carte sur https://console.mistral.ai/api-keys) :
//    supabase secrets set MISTRAL_API_KEY=... --project-ref lrslisyydbiejqzpsoxc
// =====================================================================

const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY")!;
const MODEL = "mistral-small-latest"; // vision, palier gratuit Mistral

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!MISTRAL_API_KEY) return json({ error: "MISTRAL_API_KEY non configurée (supabase secrets set MISTRAL_API_KEY=...)" }, 500);
    const reqBody = await req.json();
    if (reqBody.list_models) {
      const r = await fetch("https://api.mistral.ai/v1/models", { headers: { "authorization": "Bearer " + MISTRAL_API_KEY } });
      const j = await r.json();
      return json({ models: (j.data ?? []).map((m: any) => m.id) });
    }
    const { image_b64, mime, categories, fournisseurs } = reqBody;
    if (!image_b64) return json({ error: "image_b64 manquant" }, 400);
    if ((mime ?? "").includes("pdf")) return json({ error: "PDF non supporté par le scan IA gratuit — prends une photo de la facture (JPG/PNG)." }, 400);

    const catList = (categories ?? []).join(", ");
    const fourList = (fournisseurs ?? []).join(", ");
    const prompt =
      "Tu es un assistant comptable. Analyse cette facture française et réponds UNIQUEMENT par un objet JSON avec exactement ces clés :\n" +
      '{"fournisseur": string, "numero_facture": string, "date": "AAAA-MM-JJ", "montant_ht": number, "montant_ttc": number, "devise": string, "categorie": string, "detail": string, "confidence": number}\n' +
      "- numero_facture = le numéro de la facture (référence), vide si absent.\n" +
      "- montant_ht = montant HORS TAXES (nombre, point décimal). montant_ttc = TTC.\n" +
      "- devise : code ISO (EUR, ILS...).\n" +
      (fourList ? `- fournisseur : réutilise EXACTEMENT un existant si proche. Existants : ${fourList}.\n` : "") +
      (catList ? `- categorie : de préférence parmi : ${catList}. Sinon la plus adaptée.\n` : "") +
      "- detail : court objet (n° facture / prestation).\n" +
      "- confidence : 0 à 1. N'invente rien : champ illisible = vide + confiance basse.";

    const dataUrl = `data:${mime || "image/jpeg"};base64,${image_b64}`;
    const body = {
      model: MODEL,
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: dataUrl },
        ],
      }],
    };

    const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": "Bearer " + MISTRAL_API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return json({ error: `Mistral API ${resp.status}: ${await resp.text()}` }, 502);
    const result = await resp.json();
    const text: string = result?.choices?.[0]?.message?.content ?? "";
    if (!text) return json({ error: "pas d'extraction retournée" }, 502);

    let extracted: any = null;
    try { extracted = JSON.parse(text); }
    catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { extracted = JSON.parse(m[0]); } catch { /* ignore */ } }
    }
    if (!extracted || typeof extracted !== "object") return json({ error: "réponse IA non exploitable" }, 502);
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
