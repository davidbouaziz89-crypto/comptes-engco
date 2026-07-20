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

// Cles de projet/outil valides : projets comptes (led, velo) + outils externes.
const VALID_KEYS = ["led", "velo", "docucrm", "crmformation", "pointage", "crmpv"];
// Rôles propres à chaque logiciel (hors 'admin', global). Les projets compta (led/velo/docucrm)
// utilisent les rôles configurables d'app_roles.
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

    const body = await req.json();
    const email = (body.email || "").trim();
    const password = body.password || "";
    if (!email || !password) return json({ error: "Email et mot de passe requis" }, 400);
    if (String(password).length < 6) return json({ error: "Mot de passe trop court (6 caractères minimum)" }, 400);

    let memberships = Array.isArray(body.memberships) ? body.memberships : null;
    if (!memberships) {
      if (!body.role) return json({ error: "Rôle requis" }, 400);
      memberships = [{ project_key: "led", role: body.role, regie_name: body.regie_name || null }];
    }
    if (!memberships.length) return json({ error: "Choisis au moins un projet" }, 400);

    const { data: roleRows } = await admin.from("app_roles").select("role_key");
    const comptaRoles = new Set((roleRows || []).map((r: { role_key: string }) => r.role_key));
    for (const m of memberships) {
      if (!VALID_KEYS.includes(m.project_key)) return json({ error: "Projet invalide" }, 400);
      const allowed = CRM_ROLES[m.project_key] || [...comptaRoles];
      if (m.role !== "admin" && !allowed.includes(m.role)) return json({ error: "Rôle invalide" }, 400);
    }

    // Le demandeur doit être administrateur (global : admin d'au moins un projet).
    const { data: callerMems } = await admin.from("app_memberships").select("role").eq("user_id", userData.user.id);
    const callerIsAdmin = (callerMems || []).some((m: { role: string }) => m.role === "admin");
    if (!callerIsAdmin) return json({ error: "Réservé à l'administrateur" }, 403);

    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (cErr || !created?.user) return json({ error: cErr?.message || "Création impossible" }, 400);

    const rows = memberships.map((m: {project_key:string; role:string; regie_name?:string}) => ({
      user_id: created.user.id, project_key: m.project_key, role: m.role,
      regie_name: m.regie_name || null, email,
    }));
    const { error: e2 } = await admin.from("app_memberships").insert(rows);
    if (e2) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: e2.message }, 400); }

    // CRM Photovoltaïque : crée directement le profil (nom, rôles multiples, adresse) sans attendre la 1re connexion.
    const pvMem = memberships.find((m: {project_key:string}) => m.project_key === "crmpv");
    if (pvMem) {
      const prof = body.profile || {};
      const roles = Array.isArray(body.roles) ? body.roles : [];
      await admin.from("pv_profiles").upsert({
        id: created.user.id, email, nom: body.nom || null, role: (pvMem as {role:string}).role,
        roles, actif: true,
        adresse: prof.adresse || null, code_postal: prof.code_postal || null, ville: prof.ville || null,
      }, { onConflict: "id" });
    }

    return json({ ok: true, email, id: created.user.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
