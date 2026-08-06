-- Marketing IA — connexions aux réseaux sociaux.
-- Un jeton par société et par réseau. Jamais exposé au navigateur :
-- seules les fonctions serveur y accèdent (aucune policy de lecture).
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

create table if not exists public.mkt_social (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.mkt_companies(id) on delete cascade,
  network text not null check (network in ('linkedin','instagram','facebook')),
  account_id text,                 -- id de la Page Facebook ou du compte Instagram pro
  account_name text,
  access_token text,               -- jeton d'accès (lecture réservée au serveur)
  expires_at timestamptz,          -- null = n'expire pas
  connected_at timestamptz not null default now(),
  unique (company_id, network)
);

alter table public.mkt_social enable row level security;

-- L'app peut savoir si c'est connecté et le déconnecter, mais ne lit jamais le jeton :
-- la vue ci-dessous expose tout sauf le secret.
drop policy if exists mkt_social_manage on public.mkt_social;
create policy mkt_social_manage on public.mkt_social for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

create or replace view public.mkt_social_public as
  select id, company_id, network, account_id, account_name, expires_at, connected_at
  from public.mkt_social;

grant select, insert, update, delete on public.mkt_social to authenticated;
grant select on public.mkt_social_public to authenticated;
