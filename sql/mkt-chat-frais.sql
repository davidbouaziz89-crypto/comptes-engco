-- Marketing IA — discussion avec l'équipe d'agents + suivi des coûts IA.
-- Idempotent : peut être relancé sans risque. À lancer dans l'éditeur SQL Supabase
-- sur le projet unified-backend (lrslisyydbiejqzpsoxc).

-- ============ 1) Discussions ============
create table if not exists public.mkt_chats (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade default auth.uid(),
  company_id uuid references public.mkt_companies(id) on delete cascade,
  title text,
  participants text[] not null default '{orchestrateur}',   -- clés des agents présents
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_chats_owner_idx on public.mkt_chats(owner, updated_at desc);

create table if not exists public.mkt_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.mkt_chats(id) on delete cascade,
  role text not null check (role in ('user','agent','system')),
  agent text,                                                -- clé de l'agent qui parle
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists mkt_messages_chat_idx on public.mkt_messages(chat_id, created_at);

-- ============ 1 bis) L'équipe : prénom, rôle et portrait de chaque agent ============
create table if not exists public.mkt_team (
  owner uuid not null references auth.users(id) on delete cascade default auth.uid(),
  agent_key text not null,              -- orchestrateur | analyste | redacteur | designer
  first_name text not null,
  role text not null,
  avatar_url text,
  updated_at timestamptz not null default now(),
  primary key (owner, agent_key)
);

-- ============ 2) Consommation IA (frais) ============
create table if not exists public.mkt_usage (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade default auth.uid(),
  company_id uuid references public.mkt_companies(id) on delete set null,
  source text not null,                 -- analyse | generation | image | discussion
  agent text,                           -- clé de l'agent responsable
  provider text not null,               -- anthropic | google
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  images integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists mkt_usage_owner_idx on public.mkt_usage(owner, created_at desc);

-- ============ 3) RLS ============
alter table public.mkt_chats    enable row level security;
alter table public.mkt_messages enable row level security;
alter table public.mkt_usage    enable row level security;
alter table public.mkt_team     enable row level security;

drop policy if exists mkt_team_all on public.mkt_team;
create policy mkt_team_all on public.mkt_team for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Helper : la discussion appartient-elle à l'appelant ?
create or replace function public.mkt_chat_owns(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mkt_chats c where c.id = cid and c.owner = auth.uid());
$$;

drop policy if exists mkt_chat_all on public.mkt_chats;
create policy mkt_chat_all on public.mkt_chats for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists mkt_msg_all on public.mkt_messages;
create policy mkt_msg_all on public.mkt_messages for all to authenticated
  using (public.mkt_chat_owns(chat_id)) with check (public.mkt_chat_owns(chat_id));

drop policy if exists mkt_usage_read on public.mkt_usage;
create policy mkt_usage_read on public.mkt_usage for select to authenticated
  using (owner = auth.uid());

grant select, insert, update, delete on public.mkt_chats, public.mkt_messages, public.mkt_team to authenticated;
grant select on public.mkt_usage to authenticated;
