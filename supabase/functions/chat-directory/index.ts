// Annuaire du chat : liste les collègues (auth requise, tout utilisateur).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function nameFrom(email: string) {
  const n = (email || "").split("@")[0].replace(/[._\-+]+/g, " ").trim();
  return n ? n.replace(/\b\w/g, (c) => c.toUpperCase()) : email;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json({ error: "Non authentifié" }, 401);

    const out: { user_id: string; email: string; display_name: string; genre: string | null }[] = [];
    for (let p = 1; p <= 20; p++) {
      const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
      const users = data?.users || [];
      for (const x of users) {
        if (x.id === u.user.id) continue;
        const md = (x.user_metadata || {}) as { genre?: string; prenom?: string; nom?: string };
        const full = [md.prenom, md.nom].filter(Boolean).join(" ").trim();
        out.push({
          user_id: x.id,
          email: x.email || "",
          display_name: full || nameFrom(x.email || ""),
          genre: md.genre || null,
        });
      }
      if (users.length < 1000) break;
    }
    out.sort((a, b) => a.display_name.localeCompare(b.display_name));
    return json({ users: out });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
