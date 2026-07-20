import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const VALID_KEYS = ["led", "velo", "docucrm", "crmformation", "pointage", "crmpv"];
// Rôles propres à chaque logiciel (hors 'admin', global). Compta (led/velo/docucrm) = app_roles.
const CRM_ROLES: Record<string, string[]> = {
  crmpv: ["telepro", "confirmateur", "commercial", "cq", "financement", "paiement"],
  crmformation: ["secretaire", "commercial"],
  pointage: ["manager", "comptable", "employe"],
  docucrm: ["secretaire"],
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Non authentifié" }, 401);

    const { data: callerMems } = await admin.from("app_memberships").select("role").eq("user_id", userData.user.id);
    const callerIsAdmin = (callerMems || []).some((m: { role: string }) => m.role === "admin");
    if (!callerIsAdmin) return json({ error: "Réservé à l'administrateur" }, 403);

    const body = await req.json();
    const action = body.action;
    const target = (body.user_id || "").trim();
    if (!target) return json({ error: "Utilisateur manquant" }, 400);

    if (action === "delete") {
      if (target === userData.user.id) return json({ error: "Tu ne peux pas supprimer ton propre compte." }, 400);
      await admin.from("app_memberships").delete().eq("user_id", target);
      const { error: dErr } = await admin.auth.admin.deleteUser(target);
      if (dErr) return json({ error: dErr.message }, 400);
      return json({ ok: true });
    }

    if (action === "update") {
      const memberships = Array.isArray(body.memberships) ? body.memberships : [];
      const email = (body.email || "").trim();
      const { data: roleRows } = await admin.from("app_roles").select("role_key");
      const comptaRoles = new Set((roleRows || []).map((r: { role_key: string }) => r.role_key));
      for (const m of memberships) {
        if (!VALID_KEYS.includes(m.project_key)) return json({ error: "Projet invalide" }, 400);
        const allowed = CRM_ROLES[m.project_key] || [...comptaRoles];
        if (m.role !== "admin" && !allowed.includes(m.role)) return json({ error: "Rôle invalide" }, 400);
      }
      if (target === userData.user.id && !memberships.some((m: { role: string }) => m.role === "admin"))
        return json({ error: "Tu ne peux pas retirer ton propre rôle admin." }, 400);

      await admin.from("app_memberships").delete().eq("user_id", target);
      if (memberships.length) {
        const rows = memberships.map((m: { project_key: string; role: string; regie_name?: string }) => ({
          user_id: target, project_key: m.project_key, role: m.role,
          regie_name: m.regie_name || null, email,
        }));
        const { error: iErr } = await admin.from("app_memberships").insert(rows);
        if (iErr) return json({ error: iErr.message }, 400);
      }
      const password = body.password || "";
      if (password) {
        if (String(password).length < 6) return json({ error: "Mot de passe trop court (6 caractères minimum)" }, 400);
        const { error: pErr } = await admin.auth.admin.updateUserById(target, { password });
        if (pErr) return json({ error: pErr.message }, 400);
      }
      return json({ ok: true });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
