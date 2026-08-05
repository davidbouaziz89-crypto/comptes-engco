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
