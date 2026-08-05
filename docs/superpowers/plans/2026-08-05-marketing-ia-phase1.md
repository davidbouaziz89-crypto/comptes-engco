# Marketing IA — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer la Phase 1 du logiciel Marketing IA : une app intégrée au portail `comptes-engco` où David crée 2–3 sociétés, définit pour chacune une ligne éditoriale + une cadence, puis génère (via des agents IA Claude) des posts qu'il valide/modifie/refuse dans un calendrier éditorial. **Aucune publication externe en Phase 1.**

**Architecture :** Une nouvelle page HTML/JS autonome (`marketing.html`) dans le repo `comptes-engco`, sur la base Supabase unified-backend (`lrslisyydbiejqzpsoxc`). Les données vivent dans des tables `mkt_*` protégées par RLS (propriétaire = `auth.uid()`). La génération IA se fait **côté serveur** dans une edge function `mkt-generate` (pattern identique à `compta-ia`), qui appelle Claude et insère les posts. Le frontend n'appelle jamais l'API Claude directement et ne voit jamais de clé secrète.

**Tech Stack :** HTML/CSS/JS vanilla (pas de build), `@supabase/supabase-js@2` via CDN, GitHub Pages pour l'hébergement, Supabase (Postgres + RLS + Edge Functions Deno), Claude API (`claude-opus-4-8`) via edge function. Déploiement edge function + secrets via `npx supabase@latest` (CLI déjà authentifié).

## Global Constraints

- **Base Supabase :** projet unique `lrslisyydbiejqzpsoxc` (URL `https://lrslisyydbiejqzpsoxc.supabase.co`, clé publishable client `sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP`).
- **Sécurité :** aucune clé API (Claude/réseaux) ni service-role dans le navigateur. Toute génération IA passe par l'edge function. Le secret `ANTHROPIC_API_KEY` **existe déjà** sur le projet (utilisé par `compta-ia`) — le réutiliser, ne pas le redemander à David.
- **Multi-tenant :** toutes les tables `mkt_*` sont protégées par RLS ; un utilisateur ne voit que les sociétés dont il est `owner` (= `auth.uid()`).
- **Nommage :** toutes les tables/objets SQL de ce projet sont préfixés `mkt_`. Fichier SQL unique : `sql/mkt-setup.sql`. Edge function : `supabase/functions/mkt-generate/index.ts`. Page : `marketing.html`. Manifest : `manifest-marketing.webmanifest`.
- **Réseaux Phase 1 :** valeurs autorisées `linkedin`, `instagram`, `facebook` (LinkedIn est le prioritaire ; les autres sont configurables mais non publiés en Phase 1).
- **Statuts de post :** `brouillon`, `a_valider`, `valide`, `publie`, `refuse`, `pause`. Défaut à la génération : `a_valider`.
- **Langue par défaut du contenu :** `fr`.
- **Modèle IA :** `claude-opus-4-8`, `anthropic-version: 2023-06-01`, surchargeable via secret optionnel `MKT_MODEL`.
- **Design system :** réutiliser les tokens CSS `:root` (thème sombre + `[data-theme="light"]`) et les polices (Space Grotesk / Inter / JetBrains Mono) exactement comme dans `photovoltaique.html`. Pas de nouveau design system.
- **Pas de framework de test dans ce repo.** La vérification de chaque tâche est concrète : `curl` pour l'edge function, manipulation réelle dans le navigateur pour l'UI, `list_tables`/SELECT pour la base. C'est le "test" de chaque tâche.
- **Attention :** `index.html` a une modification non commitée au moment d'écrire ce plan. Avant la Tâche 5 (qui modifie `index.html`), committer ou coordonner cette modif en cours avec David — ne pas l'écraser.

---

## File Structure

- `sql/mkt-setup.sql` — **Create.** Schéma complet : tables `mkt_companies`, `mkt_editorial`, `mkt_cadence`, `mkt_posts`, RLS, grants. Idempotent (`create table if not exists`, `drop policy if exists`). David le lance dans l'éditeur SQL Supabase (comme les autres `sql/*.sql`).
- `supabase/functions/mkt-generate/index.ts` — **Create.** Les agents (Orchestrateur + Contenu) : auth, chargement éditorial+cadence, appel Claude en sortie structurée, calcul des dates planifiées, insertion des posts. Déployée via CLI.
- `marketing.html` — **Create.** L'app : garde d'authentification, sélecteur de société, formulaires ligne éditoriale + cadence, bouton "Générer la semaine", calendrier/liste des posts avec statuts et boutons Valider/Modifier/Refuser.
- `manifest-marketing.webmanifest` — **Create.** Manifeste PWA (scope `/`, icônes `marketing-*`).
- `icons/marketing-{192,512,apple-180,maskable-512}.png` — **Create.** Icônes placeholder (dégradé + "M·IA") ; David pourra les remplacer par son visuel ChatGPT plus tard.
- `index.html` — **Modify** (Tâche 5). Ajouter la tuile `marketingia` dans l'objet `EXTERNAL_TOOLS` (~ligne 1116-1124).

---

### Task 1: Schéma base de données (`sql/mkt-setup.sql`)

**Files:**
- Create: `sql/mkt-setup.sql`

**Interfaces:**
- Produces (noms/colonnes utilisés par toutes les tâches suivantes) :
  - `public.mkt_companies(id uuid pk, owner uuid = auth.uid(), name text, activity text, created_at timestamptz)`
  - `public.mkt_editorial(company_id uuid pk→mkt_companies, tone text, audience text, topics text, dos text, donts text, language text='fr', updated_at timestamptz)`
  - `public.mkt_cadence(id uuid pk, company_id uuid→mkt_companies, network text, per_week int, days int[], hour int, active bool, unique(company_id,network))`
  - `public.mkt_posts(id uuid pk, company_id uuid→mkt_companies, network text, body text, visual_idea text, caption text, scheduled_at timestamptz, status text='a_valider', external_id text, created_at timestamptz, updated_at timestamptz)`
  - RLS : sur les 4 tables, accès autorisé seulement si la société appartient à `auth.uid()`.

- [ ] **Step 1: Écrire le fichier SQL complet**

Create `sql/mkt-setup.sql`:

```sql
-- Marketing IA — schéma Phase 1. À lancer dans l'éditeur SQL Supabase (projet lrslisyydbiejqzpsoxc).
-- Idempotent : peut être relancé sans casser l'existant.

-- 1) Sociétés (multi-tenant : owner = utilisateur propriétaire)
create table if not exists public.mkt_companies (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  activity text,
  created_at timestamptz not null default now()
);

-- 2) Ligne éditoriale (1 par société)
create table if not exists public.mkt_editorial (
  company_id uuid primary key references public.mkt_companies(id) on delete cascade,
  tone text,
  audience text,
  topics text,
  dos text,
  donts text,
  language text not null default 'fr',
  updated_at timestamptz not null default now()
);

-- 3) Cadence (1 ligne par société × réseau)
create table if not exists public.mkt_cadence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.mkt_companies(id) on delete cascade,
  network text not null check (network in ('linkedin','instagram','facebook')),
  per_week int not null default 0,
  days int[] not null default '{1,3,5}',    -- 0=dimanche ... 6=samedi
  hour int not null default 9,
  active boolean not null default true,
  unique (company_id, network)
);

-- 4) Posts
create table if not exists public.mkt_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.mkt_companies(id) on delete cascade,
  network text not null check (network in ('linkedin','instagram','facebook')),
  body text,
  visual_idea text,
  caption text,
  scheduled_at timestamptz,
  status text not null default 'a_valider'
    check (status in ('brouillon','a_valider','valide','publie','refuse','pause')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_posts_company_idx on public.mkt_posts(company_id, scheduled_at);

-- RLS
alter table public.mkt_companies enable row level security;
alter table public.mkt_editorial enable row level security;
alter table public.mkt_cadence   enable row level security;
alter table public.mkt_posts     enable row level security;

-- Helper : la société appartient-elle à l'appelant ?
create or replace function public.mkt_owns(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mkt_companies c where c.id = cid and c.owner = auth.uid());
$$;

-- mkt_companies : owner = auth.uid()
drop policy if exists mkt_comp_all on public.mkt_companies;
create policy mkt_comp_all on public.mkt_companies for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- tables enfant : via mkt_owns(company_id)
drop policy if exists mkt_edit_all on public.mkt_editorial;
create policy mkt_edit_all on public.mkt_editorial for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

drop policy if exists mkt_cad_all on public.mkt_cadence;
create policy mkt_cad_all on public.mkt_cadence for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

drop policy if exists mkt_post_all on public.mkt_posts;
create policy mkt_post_all on public.mkt_posts for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

grant select, insert, update, delete on
  public.mkt_companies, public.mkt_editorial, public.mkt_cadence, public.mkt_posts
  to authenticated;
```

- [ ] **Step 2: David lance le SQL**

Action David (l'exécutant lui fournit ce texte) : ouvrir le **dashboard Supabase → projet unified-backend → SQL Editor**, coller le contenu de `sql/mkt-setup.sql`, cliquer **Run**. Attendu : "Success. No rows returned".

- [ ] **Step 3: Vérifier que les tables existent**

Vérification (via MCP Supabase, lecture seule) : lister les tables du schéma `public` et confirmer la présence de `mkt_companies`, `mkt_editorial`, `mkt_cadence`, `mkt_posts`.
Attendu : les 4 tables apparaissent. (Équivalent SQL de contrôle : `select table_name from information_schema.tables where table_schema='public' and table_name like 'mkt_%';` → 4 lignes.)

- [ ] **Step 4: Commit**

```bash
git add sql/mkt-setup.sql
git commit -m "feat(marketing-ia): schéma Phase 1 (mkt_* tables + RLS)"
```

---

### Task 2: Edge function `mkt-generate` (les agents IA)

**Files:**
- Create: `supabase/functions/mkt-generate/index.ts`

**Interfaces:**
- Consumes (Tâche 1) : tables `mkt_companies`, `mkt_editorial`, `mkt_cadence`, `mkt_posts`.
- Produces (contrat HTTP consommé par la Tâche 4) :
  - **Requête :** `POST /functions/v1/mkt-generate`, header `Authorization: Bearer <access_token>`, body JSON `{ company_id: string, week_start?: string /* AAAA-MM-JJ, défaut = lundi de la semaine courante */ , networks?: string[] /* défaut = réseaux actifs de la cadence */ }`.
  - **Réponse succès :** `{ ok: true, created: Array<{ id, network, body, visual_idea, caption, scheduled_at, status }>, usage }`.
  - **Réponses erreur :** `{ error: string }` avec statut 400/401/403/500/502.

- [ ] **Step 1: Écrire l'edge function complète**

Create `supabase/functions/mkt-generate/index.ts`:

```typescript
// Marketing IA — génération de posts (agents Orchestrateur + Contenu).
// Auth : l'appelant doit être owner de la société. Secret requis : ANTHROPIC_API_KEY (déjà posé).
// Modèle surchargeable via secret MKT_MODEL (défaut claude-opus-4-8).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
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
      .select("id, name, activity, owner").eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "Société introuvable." }, 404);
    if (company.owner !== uid) return json({ error: "Accès refusé à cette société." }, 403);

    // 2) Charger ligne éditoriale + cadence
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
      ed.tone ? `Ton : ${ed.tone}` : null,
      ed.audience ? `Cible : ${ed.audience}` : null,
      ed.topics ? `Thèmes à couvrir : ${ed.topics}` : null,
      ed.dos ? `À faire : ${ed.dos}` : null,
      ed.donts ? `À éviter : ${ed.donts}` : null,
      `Langue : ${ed.language || "fr"}`,
    ].filter(Boolean).join("\n");

    const instruction = `Tu es une équipe marketing pour la société « ${company.name} »${company.activity ? ` (${company.activity})` : ""}.
Rédige ${totalPosts} post(s) de réseaux sociaux pour la semaine, répartis ainsi :
${perNet}

Ligne éditoriale :
${editorialBlock}

Contraintes de rédaction :
- Adapte le style à chaque réseau : LinkedIn = professionnel B2B, structuré, orienté valeur/leads ; Instagram = visuel, chaleureux, hashtags ; Facebook = accessible, communautaire.
- Chaque post doit pouvoir être publié tel quel (pas de « [insérer ... ] »).
- Pour chaque post, propose aussi une idée de visuel concrète (visual_idea) et une légende courte / hashtags (caption).
- Varie les angles d'un post à l'autre, reste cohérent avec la ligne éditoriale.
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

    // 6) Calcul des dates + insertion (une file de dates par réseau)
    const dateQueue: Record<string, string[]> = {};
    for (const c of cadence) {
      dateQueue[c.network] = scheduleDates(weekMonday, c.days, c.hour, c.per_week);
    }
    const rows = parsed.posts.map((p) => {
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
      };
    });
    const { data: created, error: insErr } = await admin.from("mkt_posts").insert(rows)
      .select("id, network, body, visual_idea, caption, scheduled_at, status");
    if (insErr) return json({ error: "Insertion échouée : " + insErr.message }, 500);

    return json({ ok: true, created: created || [], usage: out.usage || null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
```

- [ ] **Step 2: Déployer l'edge function**

Run:
```bash
cd /c/Users/admin/Projets/comptes-engco
npx supabase@latest functions deploy mkt-generate --project-ref lrslisyydbiejqzpsoxc
```
Expected: "Deployed Function mkt-generate" (pas d'erreur de compilation).

- [ ] **Step 3: Test de fumée SANS auth (doit échouer proprement)**

Run:
```bash
curl -s -X POST "https://lrslisyydbiejqzpsoxc.supabase.co/functions/v1/mkt-generate" \
  -H "Content-Type: application/json" \
  -H "apikey: sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP" \
  -d '{"company_id":"00000000-0000-0000-0000-000000000000"}'
```
Expected: `{"error":"Non authentifié"}` (statut 401). Confirme que l'auth est bien vérifiée.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mkt-generate/index.ts
git commit -m "feat(marketing-ia): edge function mkt-generate (agents IA)"
```

> Le test de bout en bout **avec** un vrai token + une vraie société est fait en Tâche 4 (via l'UI), une fois qu'on peut créer une société et une cadence.

---

### Task 3: Frontend — squelette, auth, sociétés, ligne éditoriale & cadence

**Files:**
- Create: `marketing.html`

**Interfaces:**
- Consumes (Tâche 1) : tables `mkt_companies`, `mkt_editorial`, `mkt_cadence` (via supabase-js client, RLS).
- Produces (fonctions JS globales utilisées par la Tâche 4, mêmes noms) :
  - `db` (client Supabase), `SESSION`, `CURRENT_COMPANY` (objet société sélectionnée ou null).
  - `async loadCompanies()` → remplit le sélecteur et `COMPANIES[]`.
  - `async createCompany(name, activity)` → insert + resélection.
  - `selectCompany(id)` → set `CURRENT_COMPANY`, recharge éditorial+cadence (+ posts en Tâche 4).
  - `async loadEditorial()`, `async saveEditorial()`.
  - `async loadCadence()`, `async saveCadence(network, per_week, days, hour, active)`.
  - `el(id)` helper `document.getElementById`.

- [ ] **Step 1: Créer `marketing.html` avec head + design tokens + garde d'auth**

Create `marketing.html`. Le `<head>` reprend le pattern PWA de `photovoltaique.html` (adapter noms/couleurs) ; le bloc `<style>` **copie les tokens `:root` et `:root[data-theme="light"]` et les styles de base (body, .btn, input, .authcard, header…) depuis `photovoltaique.html`** (ne pas réinventer). Couleur d'accent propre au marketing : `--accent:#7c5cff` (violet) / `--accent2:#ff5ca8`.

Structure minimale du fichier :

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Marketing IA</title>
<link rel="manifest" href="/manifest-marketing.webmanifest" />
<meta name="theme-color" content="#7c5cff" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Marketing IA" />
<link rel="apple-touch-icon" href="/icons/marketing-apple-180.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/icons/marketing-192.png" />
<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}</script>
<script>(function(){try{if(localStorage.getItem('pfp-theme')==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<style>
  /* >>> COPIER ICI le bloc :root { ... } + :root[data-theme="light"] { ... }
     + les styles de base (*, body, h1..h3, .btn, .btn.ghost, input/select/textarea,
     .authcard, header, .who, .rolebadge, .hidden, .err) depuis photovoltaique.html,
     en changeant seulement --accent:#7c5cff; --accent2:#ff5ca8; */
  .wrap{max-width:1080px;margin:0 auto;padding:18px}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .row>*{flex:1;min-width:180px}
  .cad-line{display:grid;grid-template-columns:120px 90px 1fr 80px 70px;gap:8px;align-items:center;margin-bottom:8px}
  .day-btn{padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);cursor:pointer;font-size:12px}
  .day-btn.on{background:var(--accent);color:#fff;border-color:var(--accent)}
  @media(max-width:640px){.cad-line{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
  <!-- Écran de connexion -->
  <div id="auth" class="overlay">
    <div class="authcard">
      <h1>🚀 Marketing IA</h1>
      <div class="sub">Connecte-toi pour gérer tes posts.</div>
      <label>Email</label><input id="email" type="email" autocomplete="email">
      <label>Mot de passe</label><input id="pass" type="password" autocomplete="current-password">
      <div class="err" id="autherr"></div>
      <button class="btn" id="loginBtn" style="width:100%;margin-top:12px">Se connecter</button>
    </div>
  </div>

  <!-- App -->
  <div id="app" class="hidden">
    <header>
      <h1>🚀 Marketing IA</h1>
      <select id="companySel" style="max-width:220px"></select>
      <button class="btn ghost" id="newCompanyBtn">+ Société</button>
      <div class="spacer"></div>
      <span class="who" id="who"></span>
      <a class="btn ghost" href="./index.html">← Portail</a>
      <button class="btn ghost" id="logoutBtn">Quitter</button>
    </header>
    <div class="wrap">
      <!-- Ligne éditoriale -->
      <div class="panel">
        <h2 style="margin-top:0">🎨 Ligne éditoriale</h2>
        <div class="row">
          <div><label>Ton</label><input id="ed_tone" placeholder="ex. expert, chaleureux, direct"></div>
          <div><label>Cible</label><input id="ed_audience" placeholder="ex. dirigeants de PME"></div>
        </div>
        <label>Thèmes à couvrir</label><textarea id="ed_topics" placeholder="ex. formation, financement, actualités du secteur"></textarea>
        <div class="row">
          <div><label>À faire</label><textarea id="ed_dos"></textarea></div>
          <div><label>À éviter</label><textarea id="ed_donts"></textarea></div>
        </div>
        <button class="btn" id="saveEditorialBtn">Enregistrer la ligne éditoriale</button>
        <span class="err" id="ed_msg"></span>
      </div>

      <!-- Cadence -->
      <div class="panel">
        <h2 style="margin-top:0">📆 Cadence de publication</h2>
        <div id="cadence"></div>
      </div>

      <!-- Génération + posts (rempli en Tâche 4) -->
      <div class="panel">
        <div class="row" style="align-items:center">
          <h2 style="margin:0">🗓️ Posts de la semaine</h2>
          <div style="flex:0"><button class="btn" id="generateBtn">✨ Générer la semaine</button></div>
        </div>
        <div id="genMsg" class="err"></div>
        <div id="posts"></div>
      </div>
    </div>
  </div>

<script>
const SUPABASE_URL="https://lrslisyydbiejqzpsoxc.supabase.co";
const SUPABASE_KEY="sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP";
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const el=(id)=>document.getElementById(id);
let SESSION=null, COMPANIES=[], CURRENT_COMPANY=null;
const NETWORKS=[{k:'linkedin',label:'LinkedIn'},{k:'instagram',label:'Instagram'},{k:'facebook',label:'Facebook'}];
const DAYS=[{i:1,l:'L'},{i:2,l:'M'},{i:3,l:'M'},{i:4,l:'J'},{i:5,l:'V'},{i:6,l:'S'},{i:0,l:'D'}];

// ---- Auth ----
async function boot(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){ el('auth').classList.remove('hidden'); el('app').classList.add('hidden'); return; }
  SESSION=session;
  el('who').textContent=session.user.email;
  el('auth').classList.add('hidden'); el('app').classList.remove('hidden');
  await loadCompanies();
}
el('loginBtn').onclick=async()=>{
  el('autherr').textContent='';
  const {error}=await db.auth.signInWithPassword({email:el('email').value.trim(),password:el('pass').value});
  if(error){ el('autherr').textContent=error.message; return; }
  await boot();
};
el('logoutBtn').onclick=async()=>{ await db.auth.signOut(); location.reload(); };

// ---- Sociétés ----
async function loadCompanies(){
  const {data,error}=await db.from('mkt_companies').select('*').order('created_at');
  if(error){ console.error(error); return; }
  COMPANIES=data||[];
  el('companySel').innerHTML=COMPANIES.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  if(COMPANIES.length){ selectCompany(COMPANIES[0].id); }
  else { CURRENT_COMPANY=null; }
}
el('companySel').onchange=(e)=>selectCompany(e.target.value);
el('newCompanyBtn').onclick=async()=>{
  const name=prompt("Nom de la société ?"); if(!name) return;
  const activity=prompt("Activité (facultatif) ?")||null;
  await createCompany(name.trim(),activity);
};
async function createCompany(name,activity){
  const {data,error}=await db.from('mkt_companies').insert({name,activity}).select().single();
  if(error){ alert("Erreur : "+error.message); return; }
  await loadCompanies();
  el('companySel').value=data.id; selectCompany(data.id);
}
function selectCompany(id){
  CURRENT_COMPANY=COMPANIES.find(c=>c.id===id)||null;
  loadEditorial(); loadCadence(); if(typeof loadPosts==='function') loadPosts();
}

// ---- Ligne éditoriale ----
async function loadEditorial(){
  if(!CURRENT_COMPANY) return;
  const {data}=await db.from('mkt_editorial').select('*').eq('company_id',CURRENT_COMPANY.id).maybeSingle();
  el('ed_tone').value=data?.tone||''; el('ed_audience').value=data?.audience||'';
  el('ed_topics').value=data?.topics||''; el('ed_dos').value=data?.dos||''; el('ed_donts').value=data?.donts||'';
}
el('saveEditorialBtn').onclick=saveEditorial;
async function saveEditorial(){
  if(!CURRENT_COMPANY) return;
  const payload={company_id:CURRENT_COMPANY.id,tone:el('ed_tone').value,audience:el('ed_audience').value,
    topics:el('ed_topics').value,dos:el('ed_dos').value,donts:el('ed_donts').value,updated_at:new Date().toISOString()};
  const {error}=await db.from('mkt_editorial').upsert(payload,{onConflict:'company_id'});
  el('ed_msg').textContent=error?('Erreur : '+error.message):'✅ Enregistré';
  setTimeout(()=>el('ed_msg').textContent='',2500);
}

// ---- Cadence ----
async function loadCadence(){
  if(!CURRENT_COMPANY) return;
  const {data}=await db.from('mkt_cadence').select('*').eq('company_id',CURRENT_COMPANY.id);
  const byNet={}; (data||[]).forEach(r=>byNet[r.network]=r);
  el('cadence').innerHTML=NETWORKS.map(n=>{
    const c=byNet[n.k]||{per_week:0,days:[1,3,5],hour:9,active:false};
    const days=(c.days||[]).map(String);
    return `<div class="cad-line" data-net="${n.k}">
      <label style="margin:0"><input type="checkbox" class="cad-active" ${c.active?'checked':''}> ${n.label}</label>
      <input class="cad-perweek" type="number" min="0" max="14" value="${c.per_week||0}" title="posts / semaine">
      <div class="cad-days">${DAYS.map(d=>`<span class="day-btn ${days.includes(String(d.i))?'on':''}" data-d="${d.i}">${d.l}</span>`).join('')}</div>
      <input class="cad-hour" type="number" min="0" max="23" value="${c.hour??9}" title="heure">
      <button class="btn cad-save">OK</button>
    </div>`;
  }).join('');
  el('cadence').querySelectorAll('.day-btn').forEach(b=>b.onclick=()=>b.classList.toggle('on'));
  el('cadence').querySelectorAll('.cad-save').forEach(btn=>btn.onclick=(e)=>{
    const line=e.target.closest('.cad-line');
    const net=line.dataset.net;
    const active=line.querySelector('.cad-active').checked;
    const per_week=parseInt(line.querySelector('.cad-perweek').value||'0',10);
    const hour=parseInt(line.querySelector('.cad-hour').value||'9',10);
    const days=[...line.querySelectorAll('.day-btn.on')].map(x=>parseInt(x.dataset.d,10));
    saveCadence(net,per_week,days.length?days:[1,3,5],hour,active);
  });
}
async function saveCadence(network,per_week,days,hour,active){
  const payload={company_id:CURRENT_COMPANY.id,network,per_week,days,hour,active};
  const {error}=await db.from('mkt_cadence').upsert(payload,{onConflict:'company_id,network'});
  if(error) alert('Erreur cadence : '+error.message);
}

boot();
</script>
</body>
</html>
```

- [ ] **Step 2: Servir la page en local et vérifier la connexion**

Run (depuis le repo) :
```bash
npx --yes serve -l 5055 . >/dev/null 2>&1 &
```
Ouvrir `http://localhost:5055/marketing.html`, se connecter avec le compte de David. Attendu : l'écran de connexion disparaît, l'en-tête montre l'email, le sélecteur de société est vide (aucune société encore).

- [ ] **Step 3: Créer une société et vérifier la persistance**

Dans le navigateur : cliquer **+ Société**, saisir "Test PFP" + activité. Attendu : la société apparaît dans le sélecteur. Remplir la ligne éditoriale → **Enregistrer** → message ✅. Régler la cadence LinkedIn (ex. 3 posts/sem, jours L/M/V, heure 9) → **OK**. **Recharger la page** : la société, la ligne éditoriale et la cadence sont toujours là.
Vérification base (MCP lecture) : `select name from mkt_companies;` contient "Test PFP" ; `select network, per_week from mkt_cadence;` montre linkedin=3.

- [ ] **Step 4: Commit**

```bash
git add marketing.html
git commit -m "feat(marketing-ia): app — auth, sociétés, ligne éditoriale, cadence"
```

---

### Task 4: Frontend — génération, calendrier & validation

**Files:**
- Modify: `marketing.html` (ajouter les fonctions `generateWeek`, `loadPosts`, `setPostStatus`, `savePostBody` + le rendu de la liste ; brancher le bouton `#generateBtn`).

**Interfaces:**
- Consumes (Tâche 2) : `POST /functions/v1/mkt-generate` (contrat défini en Tâche 2) ; (Tâche 3) `CURRENT_COMPANY`, `SESSION`, `db`, `el`.
- Consumes (Tâche 1) : table `mkt_posts`.
- Produces : `async loadPosts()` (appelée par `selectCompany`), `async generateWeek()`, `async setPostStatus(id,status)`, `async savePostBody(id,body)`.

- [ ] **Step 1: Ajouter le JS de génération + rendu + validation**

Dans `marketing.html`, **juste avant la ligne `boot();`**, insérer :

```javascript
// ---- Posts : génération, rendu, validation ----
const STATUS_LABEL={brouillon:'Brouillon',a_valider:'À valider',valide:'✅ Validé',publie:'Publié',refuse:'❌ Refusé',pause:'⏸️ En pause'};
const NET_LABEL={linkedin:'LinkedIn',instagram:'Instagram',facebook:'Facebook'};
function fmtDate(iso){ if(!iso) return 'non planifié'; const d=new Date(iso);
  return d.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); }

async function generateWeek(){
  if(!CURRENT_COMPANY){ return; }
  el('genMsg').textContent='⏳ Génération en cours… (10–30 s)';
  el('generateBtn').disabled=true;
  try{
    const {data:{session}}=await db.auth.getSession();
    const res=await fetch(SUPABASE_URL+'/functions/v1/mkt-generate',{
      method:'POST',
      headers:{'Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({company_id:CURRENT_COMPANY.id})
    });
    const out=await res.json();
    if(!res.ok||out.error){ el('genMsg').textContent='Erreur : '+(out.error||res.status); }
    else{ el('genMsg').textContent='✅ '+(out.created?.length||0)+' post(s) généré(s).'; }
  }catch(e){ el('genMsg').textContent='Erreur réseau : '+e.message; }
  el('generateBtn').disabled=false;
  await loadPosts();
  setTimeout(()=>el('genMsg').textContent='',4000);
}
el('generateBtn').onclick=generateWeek;

async function loadPosts(){
  if(!CURRENT_COMPANY){ el('posts').innerHTML=''; return; }
  const {data,error}=await db.from('mkt_posts').select('*').eq('company_id',CURRENT_COMPANY.id)
    .order('scheduled_at',{nullsFirst:false});
  if(error){ el('posts').innerHTML='<div class="err">'+error.message+'</div>'; return; }
  if(!data.length){ el('posts').innerHTML='<div class="who">Aucun post. Clique « Générer la semaine ».</div>'; return; }
  el('posts').innerHTML=data.map(p=>`
    <div class="panel" style="background:var(--panel2)" data-id="${p.id}">
      <div class="row" style="align-items:center">
        <strong>${NET_LABEL[p.network]||p.network}</strong>
        <span class="who">${fmtDate(p.scheduled_at)}</span>
        <span class="rolebadge">${STATUS_LABEL[p.status]||p.status}</span>
      </div>
      <textarea class="post-body" style="min-height:120px;margin-top:10px">${(p.body||'').replace(/</g,'&lt;')}</textarea>
      <div class="who" style="margin-top:6px">🎨 ${(p.visual_idea||'').replace(/</g,'&lt;')}</div>
      <div class="who">🏷️ ${(p.caption||'').replace(/</g,'&lt;')}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn act-valider">✅ Valider</button>
        <button class="btn ghost act-save">✏️ Enregistrer la modif</button>
        <button class="btn ghost act-refuser">❌ Refuser</button>
        <button class="btn ghost act-pause">⏸️ Pause</button>
      </div>
    </div>`).join('');
  el('posts').querySelectorAll('[data-id]').forEach(card=>{
    const id=card.dataset.id;
    card.querySelector('.act-valider').onclick=()=>setPostStatus(id,'valide');
    card.querySelector('.act-refuser').onclick=()=>setPostStatus(id,'refuse');
    card.querySelector('.act-pause').onclick=()=>setPostStatus(id,'pause');
    card.querySelector('.act-save').onclick=()=>savePostBody(id,card.querySelector('.post-body').value);
  });
}
async function setPostStatus(id,status){
  const {error}=await db.from('mkt_posts').update({status,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){ alert('Erreur : '+error.message); return; }
  await loadPosts();
}
async function savePostBody(id,body){
  const {error}=await db.from('mkt_posts').update({body,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){ alert('Erreur : '+error.message); return; }
  await loadPosts();
}
```

- [ ] **Step 2: Test de bout en bout — génération réelle**

Recharger `http://localhost:5055/marketing.html`, sélectionner la société "Test PFP" (avec cadence LinkedIn=3), cliquer **✨ Générer la semaine**. Attendu : après 10–30 s, message "✅ 3 post(s) généré(s)", et 3 cartes de posts LinkedIn apparaissent avec un vrai texte français cohérent avec la ligne éditoriale, une date planifiée, une idée de visuel et une légende.

- [ ] **Step 3: Test validation / modification / refus**

Sur une carte : modifier le texte → **✏️ Enregistrer la modif** (le texte persiste après reload). Cliquer **✅ Valider** → le badge passe à "✅ Validé". Sur une autre, **❌ Refuser** → badge "❌ Refusé". Recharger la page : les statuts sont conservés.
Vérification base (MCP lecture) : `select status, count(*) from mkt_posts group by status;` reflète les changements.

- [ ] **Step 4: Commit**

```bash
git add marketing.html
git commit -m "feat(marketing-ia): génération IA, calendrier et validation des posts"
```

---

### Task 5: Intégration portail + PWA installable

**Files:**
- Create: `manifest-marketing.webmanifest`
- Create: `icons/marketing-192.png`, `icons/marketing-512.png`, `icons/marketing-apple-180.png`, `icons/marketing-maskable-512.png`
- Modify: `index.html` (ajouter la tuile `marketingia` dans `EXTERNAL_TOOLS`, ~ligne 1116-1124)

**Interfaces:**
- Consumes : `sw.js` existant (scope `/`, déjà en place — ne pas modifier), `marketing.html` (Tâches 3-4).

- [ ] **Step 1: Créer le manifeste PWA**

Create `manifest-marketing.webmanifest`:

```json
{
  "id": "/marketing",
  "name": "Marketing IA",
  "short_name": "Marketing",
  "description": "Marketing IA — ProFormationPlus",
  "start_url": "/marketing.html?source=pwa",
  "scope": "/",
  "display": "standalone",
  "background_color": "#7c5cff",
  "theme_color": "#7c5cff",
  "lang": "fr",
  "icons": [
    { "src": "/icons/marketing-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/marketing-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/marketing-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Générer les 4 icônes placeholder**

Générer 4 PNG (fond dégradé violet→rose `#7c5cff`→`#ff5ca8`, emoji/lettre "🚀" ou "M" centré blanc) aux tailles 192, 512, apple-180, et maskable-512 (icône à ~80 % centrée sur fond plein pour la variante maskable), enregistrés dans `icons/marketing-{192,512,apple-180,maskable-512}.png`. Réutiliser la technique canvas décrite dans la note mémoire `pwa-install` (rendu Chromium via Playwright MCP ou `scratchpad/serve.js`).
Vérification : `ls -la icons/marketing-*.png` → 4 fichiers non vides.
> Note : icônes provisoires. David pourra fournir un visuel ChatGPT définitif ensuite (même procédure de recadrage plein cadre).

- [ ] **Step 3: Ajouter la tuile dans le portail**

⚠️ **D'abord** vérifier l'état de `index.html` (`git status`) — une modif non commitée peut exister ; coordonner avec David avant d'éditer, ne pas l'écraser.

Modifier `index.html`, dans l'objet `EXTERNAL_TOOLS` (juste après la ligne `compta:{...}`), ajouter :

```javascript
  marketingia:{ key:'marketingia', nom:'Marketing IA', icon:'🚀', url:'./marketing.html', internal:true },
```

- [ ] **Step 4: Vérifier la tuile et l'accès**

Servir le repo, ouvrir `http://localhost:5055/index.html`, se connecter avec le compte de David (admin). Attendu : une tuile **🚀 Marketing IA** apparaît sur l'écran de choix des outils ; cliquer dessus ouvre `marketing.html`.
> Si la tuile n'apparaît pas : l'accès aux outils est piloté par `app_memberships` (gestion centralisée des utilisateurs). Donner l'accès `marketingia` au compte de David via l'écran « Gestion des utilisateurs » du portail. (Ne PAS créer l'accès en dur ailleurs — cf. exigence users centralisés.)

- [ ] **Step 5: Vérifier l'installabilité PWA (facultatif mais recommandé)**

Dans Chrome desktop : DevTools → Application → Manifest : le manifeste `marketing` se charge sans erreur, icônes visibles, "Installable" ✅.

- [ ] **Step 6: Commit + push (mise en ligne)**

```bash
git add manifest-marketing.webmanifest icons/marketing-*.png index.html
git commit -m "feat(marketing-ia): tuile portail + PWA installable"
git push origin main
```
> Le `push` déclenche le redéploiement GitHub Pages : `https://gestion.proformationplus.fr/marketing.html` devient accessible en ligne (Phase 1 complète et testable en réel sur mobile, sans push encore).

---

## Vérification finale de la Phase 1 (Definition of Done)

- [ ] David peut créer 2–3 sociétés, chacune avec sa propre ligne éditoriale et sa cadence, **données séparées** (RLS).
- [ ] Le bouton « Générer la semaine » produit de vrais posts FR cohérents, par réseau, planifiés aux bons jours/heures.
- [ ] David peut **modifier**, **valider**, **refuser**, mettre en **pause** un post ; les statuts persistent.
- [ ] Aucune clé secrète n'est présente dans le navigateur (génération 100 % côté edge function).
- [ ] La tuile « Marketing IA » est accessible depuis le portail ; l'app est installable (PWA).
- [ ] **Aucune publication externe** n'a lieu (conforme au périmètre Phase 1).
- [ ] En parallèle : David a été guidé pour **démarrer la demande d'accès API LinkedIn** (préparation Phase 2) — action hors code, à initier dès maintenant.

---

## Notes de sécurité & coûts

- Le secret `ANTHROPIC_API_KEY` est **déjà** configuré sur le projet ; aucune clé n'entre dans le code ni le navigateur.
- Coût IA : `claude-opus-4-8` à l'usage. ~quelques centimes par lot de posts ; pour maîtriser, on peut poser `MKT_MODEL` sur un modèle moins cher plus tard (`npx supabase@latest secrets set MKT_MODEL=... --project-ref lrslisyydbiejqzpsoxc`) — l'edge function le prend en compte sans redeploy de code (au prochain cold start).
- Supabase + GitHub Pages : gratuits.
