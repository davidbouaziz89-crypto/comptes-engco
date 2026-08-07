-- Marketing IA — rattachement des campagnes à leurs objets Meta.
-- Sans ces identifiants, impossible de relire les chiffres réels d'une campagne
-- créée depuis l'app : c'est ce qui rend le suivi automatique possible.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

alter table public.mkt_ads add column if not exists external_campaign_id text;
alter table public.mkt_ads add column if not exists external_adset_id text;
alter table public.mkt_ads add column if not exists external_ad_id text;
alter table public.mkt_ads add column if not exists synced_at timestamptz;

create index if not exists mkt_ads_campaign_idx on public.mkt_ads(external_campaign_id);
