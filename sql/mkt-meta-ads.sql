-- Marketing IA — accès à l'API Marketing de Meta (publicités).
--
-- Les jetons de Page ne servent qu'à publier. Créer une campagne exige le jeton
-- *utilisateur*, porteur de ads_management, et l'identifiant du compte publicitaire.
-- Comme pour mkt_social : le jeton reste côté serveur, jamais lu par le navigateur.
--
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

create table if not exists public.mkt_meta_ads (
  company_id uuid primary key references public.mkt_companies(id) on delete cascade,
  ad_account_id text,              -- sans le préfixe act_
  ad_account_name text,
  user_token text,                 -- jeton longue durée (60 jours), renouvelable
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.mkt_meta_ads enable row level security;

drop policy if exists mkt_meta_ads_manage on public.mkt_meta_ads;
create policy mkt_meta_ads_manage on public.mkt_meta_ads for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

-- Vue sans le jeton : c'est tout ce que l'app a le droit de lire.
create or replace view public.mkt_meta_ads_public as
  select company_id, ad_account_id, ad_account_name, expires_at, updated_at
  from public.mkt_meta_ads;

grant select, insert, update, delete on public.mkt_meta_ads to authenticated;
grant select on public.mkt_meta_ads_public to authenticated;
