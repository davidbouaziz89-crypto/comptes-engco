-- Marketing IA — historique jour par jour des campagnes.
-- Sans cette série, on ne peut afficher qu'un total figé, jamais une évolution :
-- Meta ne conserve pas l'historique sous une forme réutilisable côté app.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

create table if not exists public.mkt_ads_daily (
  ad_id uuid not null references public.mkt_ads(id) on delete cascade,
  jour date not null,
  depense numeric(12,2) not null default 0,
  impressions integer not null default 0,
  clics integer not null default 0,
  leads integer not null default 0,
  primary key (ad_id, jour)
);

create index if not exists mkt_ads_daily_jour_idx on public.mkt_ads_daily(jour);

alter table public.mkt_ads_daily enable row level security;

drop policy if exists mkt_ads_daily_read on public.mkt_ads_daily;
create policy mkt_ads_daily_read on public.mkt_ads_daily for select to authenticated
  using (exists (
    select 1 from public.mkt_ads a
    where a.id = mkt_ads_daily.ad_id and public.mkt_owns(a.company_id)
  ));

grant select on public.mkt_ads_daily to authenticated;
