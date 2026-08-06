# Chat interne « gestion » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un chat type Messenger (1:1 + groupes, présence, non-lus, « Vu », notifications in-app + push, pièces jointes) disponible sur toutes les apps du site gestion.

**Architecture:** Widget partagé (`chat.js` + `chat.css`) inclus par une ligne dans chaque app, avec son propre client Supabase et la session partagée. Backend commun : tables `chat_*` + RLS + fonctions SECURITY DEFINER, Supabase Realtime (presence + postgres_changes), edge functions `chat-directory` et `chat-notify`, bucket privé `chat-files`.

**Tech Stack:** HTML/JS vanilla, Supabase (Postgres + Realtime + Storage + Edge Functions Deno), Web Push existant (`send-push` + `push_subscriptions` + VAPID).

## Global Constraints

- Base Supabase unique : `lrslisyydbiejqzpsoxc` (`https://lrslisyydbiejqzpsoxc.supabase.co`), clé publiable `sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP`.
- Déploiement front : édition HTML → `git commit && git push` sur `main` → GitHub Pages (`gestion.proformationplus.fr`). Aucune étape de build.
- Edge functions : déploiement via CLI `npx supabase@latest functions deploy <nom> --project-ref lrslisyydbiejqzpsoxc` (authentifié).
- Le MCP Supabase est en **lecture seule** : les migrations DDL + policies storage s'appliquent via le **SQL editor du dashboard** (SQL fourni verbatim ci-dessous) ou la CLI ; `execute_sql` (MCP) sert uniquement à vérifier en lecture.
- CSS/JS du widget préfixés `egc-` / `egcChat` ; aucune variable globale qui fuit.
- 9 apps concernées : `index.html`, `crm.html`, `notelia.html`, `compta.html`, `photovoltaique.html`, `pointage.html`, `documents.html`, `portail.html`, `marketing.html`.
- Taille max pièce jointe : 25 Mo. Son de notification activé par défaut, coupable (préférence en `localStorage`).
- Pas de framework de test : la vérification se fait au **navigateur (Playwright, 2 sessions)** + **requêtes SQL de contrôle (MCP lecture)**. Un serveur statique local sert les fichiers (`node` http server sur 127.0.0.1).

---

## File Structure

- Create `supabase/migrations/2026XXXX_chat.sql` — schéma `chat_*`, index, fonctions, RLS, Realtime, policies storage.
- Create `supabase/functions/chat-directory/index.ts` — annuaire des utilisateurs (auth requise).
- Create `supabase/functions/chat-notify/index.ts` — fan-out push vers les membres.
- Create `chat.css` — styles du widget (préfixe `.egc-`).
- Create `chat.js` — logique du widget (IIFE, namespace `egcChat`).
- Modify les 9 `*.html` — ajout `<script defer src="./chat.js"></script>` avant `</body>`.
- Modify `sw.js` — handler `notificationclick` routant vers `?egcchat=<conversation_id>` (si absent).

---

## Task 1 : Schéma SQL + fonctions + RLS

**Files:**
- Create: `supabase/migrations/20260806_chat.sql`

**Interfaces:**
- Produces (SQL) : tables `chat_conversations`, `chat_members`, `chat_messages`, `chat_attachments` ; fonctions `chat_is_member(uuid,uuid) returns boolean`, `chat_get_or_create_direct(uuid) returns uuid`, `chat_create_group(text, uuid[]) returns uuid`, `chat_mark_read(uuid) returns void`.

- [ ] **Step 1 : Écrire la migration SQL**

Créer `supabase/migrations/20260806_chat.sql` :

```sql
-- ===== Tables =====
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct','group')),
  title text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.chat_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null default 'member',
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  sender_email text,
  body text,
  created_at timestamptz not null default now(),
  deleted boolean not null default false
);
create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  path text not null,
  name text,
  mime text,
  size integer
);
create index if not exists idx_chat_messages_conv on public.chat_messages(conversation_id, created_at);
create index if not exists idx_chat_members_user on public.chat_members(user_id);
create index if not exists idx_chat_conv_last on public.chat_conversations(last_message_at desc);

-- ===== Helpers SECURITY DEFINER (evitent la recursion RLS) =====
create or replace function public.chat_is_member(conv uuid, uid uuid)
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.chat_members m where m.conversation_id=conv and m.user_id=uid);
$$;

create or replace function public.chat_get_or_create_direct(other uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null or other is null or me=other then raise exception 'invalid'; end if;
  select c.id into conv from public.chat_conversations c
    where c.type='direct'
      and exists(select 1 from public.chat_members a where a.conversation_id=c.id and a.user_id=me)
      and exists(select 1 from public.chat_members b where b.conversation_id=c.id and b.user_id=other)
    limit 1;
  if conv is not null then return conv; end if;
  insert into public.chat_conversations(type, created_by) values('direct', me) returning id into conv;
  insert into public.chat_members(conversation_id, user_id, email)
    values (conv, me, (select email from auth.users where id=me)),
           (conv, other, (select email from auth.users where id=other));
  return conv;
end; $$;

create or replace function public.chat_create_group(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path=public as $$
declare me uuid := auth.uid(); conv uuid; u uuid;
begin
  if me is null then raise exception 'auth'; end if;
  insert into public.chat_conversations(type, title, created_by) values('group', coalesce(nullif(p_title,''),'Groupe'), me) returning id into conv;
  insert into public.chat_members(conversation_id, user_id, email, role)
    values (conv, me, (select email from auth.users where id=me), 'admin');
  foreach u in array coalesce(p_members,'{}') loop
    if u <> me then
      insert into public.chat_members(conversation_id, user_id, email)
        values (conv, u, (select email from auth.users where id=u))
        on conflict do nothing;
    end if;
  end loop;
  return conv;
end; $$;

create or replace function public.chat_mark_read(conv uuid)
returns void language sql security definer set search_path=public as $$
  update public.chat_members set last_read_at=now()
   where conversation_id=conv and user_id=auth.uid();
$$;

-- ===== RLS =====
alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_attachments enable row level security;

drop policy if exists conv_sel on public.chat_conversations;
create policy conv_sel on public.chat_conversations for select using (public.chat_is_member(id, auth.uid()));

drop policy if exists mem_sel on public.chat_members;
create policy mem_sel on public.chat_members for select using (public.chat_is_member(conversation_id, auth.uid()));
drop policy if exists mem_upd on public.chat_members;
create policy mem_upd on public.chat_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists msg_sel on public.chat_messages;
create policy msg_sel on public.chat_messages for select using (public.chat_is_member(conversation_id, auth.uid()));
drop policy if exists msg_ins on public.chat_messages;
create policy msg_ins on public.chat_messages for insert with check (public.chat_is_member(conversation_id, auth.uid()) and sender_id = auth.uid());

drop policy if exists att_sel on public.chat_attachments;
create policy att_sel on public.chat_attachments for select using (
  exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_is_member(m.conversation_id, auth.uid())));
drop policy if exists att_ins on public.chat_attachments;
create policy att_ins on public.chat_attachments for insert with check (
  exists(select 1 from public.chat_messages m where m.id=message_id and m.sender_id=auth.uid()));

-- ===== Realtime =====
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_members;
alter publication supabase_realtime add table public.chat_conversations;
```

- [ ] **Step 2 : Appliquer la migration**

Copier le contenu dans le **SQL editor** du dashboard Supabase (projet `lrslisyydbiejqzpsoxc`) et l'exécuter. (Alternative CLI si le projet est lié : `npx supabase@latest db push`.)

- [ ] **Step 3 : Vérifier (MCP lecture)**

Via `mcp__supabase__execute_sql` :
```sql
select table_name from information_schema.tables where table_name like 'chat\_%';
select proname from pg_proc where proname like 'chat\_%';
```
Attendu : 4 tables + 4 fonctions.

- [ ] **Step 4 : Vérifier la RLS (isolement)**

```sql
-- doit renvoyer 0 : aucune conversation visible sans contexte utilisateur (role service ignore RLS, donc on teste la policy logiquement)
select count(*) from pg_policies where tablename like 'chat\_%';
```
Attendu : ≥ 7 policies.

- [ ] **Step 5 : Commit**
```bash
git add supabase/migrations/20260806_chat.sql
git commit -m "chat: schema chat_* + fonctions + RLS + realtime"
```

---

## Task 2 : Bucket privé `chat-files` + policies storage

**Files:**
- Modify: `supabase/migrations/20260806_chat.sql` (ajout à la fin) ou nouveau `20260806_chat_storage.sql`

**Interfaces:**
- Produces : bucket `chat-files` (privé) + policies storage basées sur l'appartenance.

- [ ] **Step 1 : SQL storage**

Ajouter et exécuter (SQL editor) :
```sql
insert into storage.buckets (id, name, public) values ('chat-files','chat-files', false)
  on conflict (id) do nothing;

-- chemin = <conversation_id>/<message_id>/<nom>. On autorise si membre de la conversation (1er segment).
drop policy if exists chatfiles_sel on storage.objects;
create policy chatfiles_sel on storage.objects for select using (
  bucket_id='chat-files'
  and public.chat_is_member( (split_part(name,'/',1))::uuid, auth.uid() ));
drop policy if exists chatfiles_ins on storage.objects;
create policy chatfiles_ins on storage.objects for insert with check (
  bucket_id='chat-files'
  and public.chat_is_member( (split_part(name,'/',1))::uuid, auth.uid() ));
```

- [ ] **Step 2 : Vérifier**
```sql
select id, public from storage.buckets where id='chat-files';
select policyname from pg_policies where tablename='objects' and policyname like 'chatfiles%';
```
Attendu : bucket privé + 2 policies.

- [ ] **Step 3 : Commit**
```bash
git add supabase/migrations/20260806_chat_storage.sql
git commit -m "chat: bucket prive chat-files + policies storage"
```

---

## Task 3 : Edge function `chat-directory`

**Files:**
- Create: `supabase/functions/chat-directory/index.ts`

**Interfaces:**
- Produces : `POST /functions/v1/chat-directory` (Authorization = JWT utilisateur) → `{ users: [{user_id, email, display_name, genre}] }`. Tout utilisateur authentifié y a accès.

- [ ] **Step 1 : Écrire la fonction**

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json = (o:unknown,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{...cors,"Content-Type":"application/json"}});
function nameFrom(email:string){ const n=(email||"").split("@")[0].replace(/[._\-+]+/g," ").trim(); return n?n.replace(/\b\w/g,c=>c.toUpperCase()):email; }
Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token=(req.headers.get("Authorization")||"").replace("Bearer ","");
    const { data:u, error } = await admin.auth.getUser(token);
    if(error||!u?.user) return json({error:"Non authentifié"},401);
    const out:{user_id:string;email:string;display_name:string;genre:string|null}[]=[];
    for(let p=1;p<=20;p++){
      const { data } = await admin.auth.admin.listUsers({page:p, perPage:1000});
      const users=data?.users||[];
      for(const x of users){ if(x.id===u.user.id) continue;
        out.push({ user_id:x.id, email:x.email||"", display_name:nameFrom(x.email||""), genre:(x.user_metadata&&x.user_metadata.genre)||null }); }
      if(users.length<1000) break;
    }
    out.sort((a,b)=>a.display_name.localeCompare(b.display_name));
    return json({ users: out });
  }catch(e){ return json({error:String((e as Error)?.message||e)},500); }
});
```

- [ ] **Step 2 : Déployer**
```bash
npx supabase@latest functions deploy chat-directory --project-ref lrslisyydbiejqzpsoxc
```
Attendu : `Deployed Functions.`

- [ ] **Step 3 : Vérifier (navigateur, session connectée)**

Sur une app ouverte connectée, dans la console :
```js
const s=(await db.auth.getSession()).data.session;
const r=await fetch(SUPABASE_URL+'/functions/v1/chat-directory',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,apikey:SUPABASE_KEY}});
console.log(await r.json());
```
Attendu : `{users:[...]}` sans son propre compte.

- [ ] **Step 4 : Commit**
```bash
git add supabase/functions/chat-directory/index.ts
git commit -m "chat: edge function chat-directory (annuaire)"
```

---

## Task 4 : Edge function `chat-notify` (push fan-out)

**Files:**
- Create: `supabase/functions/chat-notify/index.ts`
- Reference: `supabase/functions/send-push/index.ts` (logique VAPID existante à réutiliser)

**Interfaces:**
- Consumes : table `push_subscriptions` (colonnes à confirmer en Step 1), secrets VAPID de `send-push`.
- Produces : `POST /functions/v1/chat-notify` body `{conversation_id, message_id}` (JWT) → pousse aux autres membres non mutés.

- [ ] **Step 1 : Inspecter `send-push` et `push_subscriptions`**

Lire `supabase/functions/send-push/index.ts` pour récupérer : nom des secrets VAPID, format d'envoi, et le schéma exact de `push_subscriptions` (colonnes `user_id`, `endpoint`, `p256dh`, `auth`, …). Adapter les noms dans le Step 2.

- [ ] **Step 2 : Écrire la fonction**

Squelette (adapter les colonnes/champs VAPID au vu du Step 1) :
```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json=(o:unknown,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const admin=createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token=(req.headers.get("Authorization")||"").replace("Bearer ","");
    const { data:u } = await admin.auth.getUser(token);
    if(!u?.user) return json({error:"auth"},401);
    const { conversation_id, message_id } = await req.json();
    // Appelant doit etre membre
    const { data:mem } = await admin.from("chat_members").select("user_id,muted").eq("conversation_id",conversation_id);
    if(!(mem||[]).some(m=>m.user_id===u.user.id)) return json({error:"forbidden"},403);
    const { data:msg } = await admin.from("chat_messages").select("body,sender_email").eq("id",message_id).single();
    const { data:conv } = await admin.from("chat_conversations").select("type,title").eq("id",conversation_id).single();
    const senderName=(msg?.sender_email||"").split("@")[0];
    const title = conv?.type==="group" ? (conv.title||"Groupe") : senderName;
    const bodyTxt = (msg?.body||"📎 Pièce jointe").slice(0,120);
    webpush.setVapidDetails("mailto:noreply@leadscall-ia.com", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
    const targets=(mem||[]).filter(m=>m.user_id!==u.user.id && !m.muted).map(m=>m.user_id);
    if(targets.length){
      const { data:subs } = await admin.from("push_subscriptions").select("*").in("user_id",targets);
      const payload=JSON.stringify({ title, body:bodyTxt, data:{ url:"/index.html?egcchat="+conversation_id } });
      await Promise.all((subs||[]).map(async s=>{
        try{ await webpush.sendNotification({endpoint:s.endpoint, keys:{p256dh:s.p256dh, auth:s.auth}}, payload); }catch(_){}
      }));
    }
    return json({ ok:true, pushed: targets.length });
  }catch(e){ return json({error:String((e as Error)?.message||e)},500); }
});
```

- [ ] **Step 3 : Déployer**
```bash
npx supabase@latest functions deploy chat-notify --project-ref lrslisyydbiejqzpsoxc
```

- [ ] **Step 4 : Vérifier**

Depuis une session connectée (2 comptes, l'un abonné au push), envoyer un message puis appeler `chat-notify` avec `{conversation_id,message_id}` → l'autre reçoit une notification. Vérifier `pushed >= 1`.

- [ ] **Step 5 : Commit**
```bash
git add supabase/functions/chat-notify/index.ts
git commit -m "chat: edge function chat-notify (push aux membres)"
```

---

## Task 5 : Widget — socle (bulle, panneau, session, client Supabase)

**Files:**
- Create: `chat.css`
- Create: `chat.js`
- Modify: `index.html` (ajout `<script defer src="./chat.js"></script>` avant `</body>` — uniquement pour le dev, la diffusion aux 9 apps est en Task 10)

**Interfaces:**
- Produces (global `window.egcChat`) : init auto au chargement ; crée un client Supabase interne `egcChat.sb`, lit la session, injecte le DOM `#egc-chat`.

- [ ] **Step 1 : `chat.css`** (préfixe `.egc-`, thèmes clair/sombre, responsive)

Contenu initial : styles de la bulle `.egc-bubble` (fixe bas-droite, 56px, ombre, badge `.egc-badge`), du panneau `.egc-panel` (360×520, coin bas-droite ; plein écran < 640px), en-tête, listes, bulles de message `.egc-msg.me/.them`, barre de saisie. (Écrire les règles concrètes ; pas de dépendance externe.)

- [ ] **Step 2 : `chat.js` socle**

```js
(function(){
  const URL="https://lrslisyydbiejqzpsoxc.supabase.co";
  const KEY="sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP";
  if(!window.supabase){ /* charger supabase-js si absent */
    const s=document.createElement('script'); s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.onload=boot; document.head.appendChild(s);
  } else boot();
  async function boot(){
    const sb=window.supabase.createClient(URL,KEY);
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ return; } // pas connecté → pas de widget
    // injecter <link chat.css> si absent
    if(!document.getElementById('egc-css')){ const l=document.createElement('link'); l.id='egc-css'; l.rel='stylesheet'; l.href='./chat.css'; document.head.appendChild(l); }
    const root=document.createElement('div'); root.id='egc-chat'; document.body.appendChild(root);
    window.egcChat={ sb, me:session.user, state:{ dir:[], convs:[], online:new Set(), openConv:null } };
    renderShell(root);
  }
  function renderShell(root){
    root.innerHTML=`<button class="egc-bubble" id="egc-bubble">💬<span class="egc-badge" id="egc-badge" hidden>0</span></button>
      <div class="egc-panel" id="egc-panel" hidden></div>`;
    document.getElementById('egc-bubble').onclick=togglePanel;
  }
  function togglePanel(){ const p=document.getElementById('egc-panel'); p.hidden=!p.hidden; if(!p.hidden) window.egcChat.openList&&window.egcChat.openList(); }
})();
```

- [ ] **Step 3 : Inclure dans `index.html`** (dev)

Avant `</body>` : `<script defer src="./chat.js"></script>`.

- [ ] **Step 4 : Vérifier (Playwright, serveur local)**

Servir le repo (`node` http server 127.0.0.1) ; ouvrir `index.html` ; simuler une session (ou tester la présence de la bulle après login). Attendu : la bulle `#egc-bubble` apparaît quand connecté, ouvre/ferme le panneau, **0 erreur console**.

- [ ] **Step 5 : Commit**
```bash
git add chat.css chat.js index.html
git commit -m "chat: socle du widget (bulle, panneau, session)"
```

---

## Task 6 : Annuaire, liste des conversations, présence + compteur en ligne

**Files:**
- Modify: `chat.js`

**Interfaces:**
- Consumes : `chat-directory`, tables `chat_conversations`/`chat_members`/`chat_messages`, Realtime Presence.
- Produces : `egcChat.openList()`, `egcChat.presenceCount`, canal presence `presence:gestion`.

- [ ] **Step 1 : Presence Realtime**

Dans `boot()`, après session : rejoindre un canal presence, `track({user_id, email})`, et sur `sync` recalculer `state.online` (Set d'user_id) + mettre à jour l'en-tête « 🟢 N en ligne ».
```js
const ch=sb.channel('presence:gestion',{config:{presence:{key:session.user.id}}});
ch.on('presence',{event:'sync'},()=>{ const st=ch.presenceState(); window.egcChat.state.online=new Set(Object.keys(st)); egcRenderOnline(); });
ch.subscribe(async (s)=>{ if(s==='SUBSCRIBED') await ch.track({user_id:session.user.id, email:session.user.email}); });
```

- [ ] **Step 2 : Charger l'annuaire + conversations**

`openList()` : appelle `chat-directory` (fetch avec le token), charge `chat_conversations` (RLS) triées par `last_message_at`, et pour chaque conversation le dernier message + le nombre de non-lus (messages `created_at > mon last_read_at`). Rendu : en-tête « Messages · 🟢 N en ligne » + bouton ✏️, section « En ligne », liste des conversations (avatar via `userAvatarSVG`/portrait, point vert si `online.has(user_id)`, badge non-lus).

- [ ] **Step 3 : Vérifier (2 sessions Playwright)**

Deux comptes connectés → chacun voit « 🟢 2 en ligne », point vert sur l'autre. Fermer une session → l'autre repasse à « 1 en ligne » / point gris en < 3 s.

- [ ] **Step 4 : Commit**
```bash
git add chat.js
git commit -m "chat: presence, compteur en ligne, annuaire + liste des conversations"
```

---

## Task 7 : Conversation 1:1 — envoi/réception temps réel + « Vu »

**Files:**
- Modify: `chat.js`

**Interfaces:**
- Consumes : `chat_get_or_create_direct(other)`, `chat_mark_read(conv)`, INSERT `chat_messages`, Realtime.
- Produces : `egcChat.openConversation(convId)`, `egcChat.startDirect(userId)`.

- [ ] **Step 1 : Ouvrir / créer une conversation directe**

`startDirect(userId)` → `sb.rpc('chat_get_or_create_direct',{other:userId})` → `openConversation(id)`.
`openConversation(id)` : charge les messages (RLS, ordre `created_at`), rend le fil, s'abonne aux `INSERT chat_messages` (filtre `conversation_id`) et aux `UPDATE chat_members`, appelle `sb.rpc('chat_mark_read',{conv:id})`.

- [ ] **Step 2 : Envoyer un message**
```js
async function egcSend(convId, body){
  const me=window.egcChat.me;
  const { data, error } = await window.egcChat.sb.from('chat_messages')
    .insert({conversation_id:convId, sender_id:me.id, sender_email:me.email, body}).select().single();
  if(error) return;
  await window.egcChat.sb.from('chat_conversations').update({last_message_at:new Date().toISOString()}).eq('id',convId);
  const s=(await window.egcChat.sb.auth.getSession()).data.session;
  fetch("https://lrslisyydbiejqzpsoxc.supabase.co/functions/v1/chat-notify",{method:'POST',
    headers:{Authorization:'Bearer '+s.access_token, apikey:"sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP", 'Content-Type':'application/json'},
    body:JSON.stringify({conversation_id:convId, message_id:data.id})}).catch(()=>{});
}
```

- [ ] **Step 3 : Accusé de lecture « Vu »**

Sous le dernier message que j'ai envoyé : lire le `last_read_at` de l'autre membre ; si `>=` created_at du message → « Vu HH:MM », sinon « Envoyé ». Mise à jour en direct via l'abonnement `UPDATE chat_members`. À l'ouverture d'une conversation, appeler `chat_mark_read` (met à jour mon `last_read_at`, ce qui déclenche « Vu » chez l'expéditeur).

- [ ] **Step 4 : Vérifier (2 sessions)**

A écrit à B (hors ligne possible) : message stocké ; quand B ouvre → apparaît en temps réel chez B, et A voit « Vu HH:MM » ; le badge non-lus de B se remet à 0.

- [ ] **Step 5 : Commit**
```bash
git add chat.js
git commit -m "chat: conversation 1:1 temps reel + accuse de lecture"
```

---

## Task 8 : Non-lus globaux, toast + son in-app

**Files:**
- Modify: `chat.js`, `chat.css`

**Interfaces:**
- Produces : `egcChat.refreshBadge()`, préférence son `localStorage['egc-sound']`.

- [ ] **Step 1 : Badge global**

Calculer le total de non-lus sur toutes les conversations (messages `created_at > last_read_at`, hors mes propres messages) → afficher/masquer `#egc-badge`. Recalculer sur chaque `INSERT chat_messages` et `UPDATE chat_members`.

- [ ] **Step 2 : Toast + son**

À la réception d'un message (widget fermé, ou autre conversation, expéditeur ≠ moi) : afficher un toast `.egc-toast` (avatar + nom + extrait, clic → ouvre la conversation) et jouer un petit son (WebAudio, pas de fichier), sauf si `localStorage['egc-sound']==='off'`. Bouton 🔔/🔕 dans l'en-tête pour basculer.

- [ ] **Step 3 : Vérifier**

Widget fermé chez B ; A envoie → B voit le badge s'incrémenter + toast + son ; couper le son → plus de son, badge/toast conservés.

- [ ] **Step 4 : Commit**
```bash
git add chat.js chat.css
git commit -m "chat: non-lus globaux + toast + son in-app"
```

---

## Task 9 : Groupes (création + vue + « Vu par N »)

**Files:**
- Modify: `chat.js`

**Interfaces:**
- Consumes : `chat_create_group(title, members[])`.
- Produces : `egcChat.openNewGroup()`.

- [ ] **Step 1 : Création**

Bouton ✏️ → écran « Nouvelle discussion » : liste de l'annuaire avec cases à cocher + point de présence. Si ≥ 2 sélectionnés → champ « Nom du groupe » ; `sb.rpc('chat_create_group',{p_title, p_members})` → ouvrir la conversation.

- [ ] **Step 2 : Vue groupe**

En-tête = titre + nombre de membres + nombre en ligne. Messages préfixés du nom de l'expéditeur (avatar). « Vu par N » sous mon dernier message = nombre de membres (hors moi) dont `last_read_at >=` created_at ; survol → liste des noms.

- [ ] **Step 3 : Vérifier (3 sessions)**

Groupe de 3 : les 3 reçoivent en temps réel ; « Vu par 2 » quand les 2 autres ont ouvert.

- [ ] **Step 4 : Commit**
```bash
git add chat.js
git commit -m "chat: groupes (creation, vue, vu par N)"
```

---

## Task 10 : Pièces jointes (upload + URL signée)

**Files:**
- Modify: `chat.js`, `chat.css`

**Interfaces:**
- Consumes : bucket `chat-files`, table `chat_attachments`.

- [ ] **Step 1 : Upload**

Bouton 📎 → sélection fichier (max 25 Mo, sinon message d'erreur). Créer d'abord le message (`body` vide autorisé), puis `sb.storage.from('chat-files').upload(convId+'/'+msgId+'/'+safeName, file)`, puis insérer `chat_attachments`. Diffusion temps réel comme un message.

- [ ] **Step 2 : Rendu**

Pour chaque pièce jointe : générer une URL signée `sb.storage.from('chat-files').createSignedUrl(path, 3600)`. Images (`mime` commence par `image/`) → vignette cliquable ; autres → bloc « 📄 nom · taille » téléchargeable.

- [ ] **Step 3 : Vérifier**

A envoie une image et un PDF → B les voit (vignette + lien) et peut les ouvrir. Un non-membre (3e compte) ne peut pas générer d'URL signée (policy storage) → échec attendu.

- [ ] **Step 4 : Commit**
```bash
git add chat.js chat.css
git commit -m "chat: pieces jointes (upload + url signee)"
```

---

## Task 11 : Push — routage du clic (Service Worker)

**Files:**
- Modify: `sw.js`

**Interfaces:**
- Consumes : payload `chat-notify` (`data.url = /index.html?egcchat=<id>`).

- [ ] **Step 1 : Handler `notificationclick`**

Vérifier/ajouter dans `sw.js` :
```js
self.addEventListener('notificationclick', e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'/index.html';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{
    for(const w of ws){ if('focus' in w){ w.navigate(url); return w.focus(); } }
    return clients.openWindow(url);
  }));
});
```

- [ ] **Step 2 : Ouverture auto de la conversation**

Dans `chat.js boot()` : si `location.search` contient `egcchat=<id>`, ouvrir le panneau + `openConversation(id)` après init.

- [ ] **Step 3 : Vérifier**

App fermée chez B (abonné push) ; A envoie → notif ; clic → ouvre l'app sur la bonne conversation.

- [ ] **Step 4 : Commit**
```bash
git add sw.js chat.js
git commit -m "chat: routage du clic de notification vers la conversation"
```

---

## Task 12 : Diffusion dans les 9 apps + vérif globale

**Files:**
- Modify: `crm.html`, `notelia.html`, `compta.html`, `photovoltaique.html`, `pointage.html`, `documents.html`, `portail.html`, `marketing.html` (et `index.html` déjà fait)

**Interfaces:** aucune nouvelle.

- [ ] **Step 1 : Ajouter le script**

Dans chaque fichier, insérer avant `</body>` : `<script defer src="./chat.js"></script>`.

- [ ] **Step 2 : Vérifier chaque page (Playwright)**

Servir en local ; charger les 8 pages ; pour chacune : **0 erreur console**, bulle présente (après session), pas de conflit visuel.

- [ ] **Step 3 : Scénario de bout en bout (2 sessions)**

Depuis `pointage.html` (compte A) et `crm.html` (compte B) : A écrit à B → B reçoit en temps réel ; « Vu » ; présence correcte ; une pièce jointe passe. Confirme que la conversation suit l'utilisateur d'une app à l'autre.

- [ ] **Step 3 : Commit + push**
```bash
git add crm.html notelia.html compta.html photovoltaique.html pointage.html documents.html portail.html marketing.html
git commit -m "chat: inclusion du widget dans toutes les apps gestion"
git pull --rebase origin main && git push origin main
```

---

## Self-Review (couverture spec)

- Widget partagé + inclusion 9 apps → Tasks 5, 12. ✔
- Tables `chat_*` + RLS + Realtime → Task 1. ✔
- Bucket privé + policies → Task 2. ✔
- `chat-directory` → Task 3 ; `chat-notify` → Task 4. ✔
- Présence + **compteur en ligne** → Task 6. ✔
- 1:1 temps réel + **envoi hors-ligne** + **« Vu »** → Task 7. ✔
- Non-lus + toast + son → Task 8. ✔
- Groupes + « Vu par N » → Task 9. ✔
- Pièces jointes (privé, URL signée, 25 Mo) → Task 10. ✔
- Push in-app + web + **clic → conversation** → Tasks 4, 8, 11. ✔
- Tests navigateur 2/3 sessions + RLS → Tasks 1,6,7,9,10,12. ✔

Points ouverts à lever en Task 4 Step 1 : noms exacts des colonnes `push_subscriptions` et des secrets VAPID (à confirmer en lisant `send-push`).
