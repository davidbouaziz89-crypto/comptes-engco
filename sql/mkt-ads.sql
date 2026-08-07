-- Marketing IA — publications payantes (sponsoring) et suivi du budget.
-- Une campagne = un post poussé derrière de la publicité, sur un réseau, avec un budget.
-- Le suivi est saisi à la main pour l'instant : l'API Marketing de Meta exige
-- l'autorisation ads_management et un contrôle app, qu'on n'a pas encore.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

create table if not exists public.mkt_ads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.mkt_companies(id) on delete cascade,
  post_id uuid references public.mkt_posts(id) on delete set null,
  network text not null check (network in ('linkedin','instagram','facebook')),
  nom text not null,
  objectif text,                       -- notoriete | trafic | leads | messages | ventes
  budget numeric(12,2) not null default 0,   -- budget engagé, en euros
  depense numeric(12,2) not null default 0,  -- dépense constatée
  started_at date,
  ended_at date,
  statut text not null default 'active' check (statut in ('brouillon','active','en_pause','terminee')),
  impressions integer not null default 0,
  clics integer not null default 0,
  leads integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mkt_ads_co_idx on public.mkt_ads(company_id, started_at desc);

alter table public.mkt_ads enable row level security;

drop policy if exists mkt_ads_manage on public.mkt_ads;
create policy mkt_ads_manage on public.mkt_ads for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

grant select, insert, update, delete on public.mkt_ads to authenticated;
