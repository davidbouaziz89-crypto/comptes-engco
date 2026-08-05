-- Marketing IA — évolution "onboarding automatique par l'IA".
-- Ajoute : site web + logo sur les sociétés, et le résumé de marque compris par l'IA.
-- Idempotent (add column if not exists). À lancer dans l'éditeur SQL Supabase.

alter table public.mkt_companies add column if not exists website text;
alter table public.mkt_companies add column if not exists logo_url text;

-- Résumé "ce que l'IA a compris de la marque" (rempli par l'agent Analyste de marque)
alter table public.mkt_editorial add column if not exists summary text;
-- Trace de la dernière analyse du site
alter table public.mkt_editorial add column if not exists analyzed_at timestamptz;
alter table public.mkt_editorial add column if not exists source_url text;
