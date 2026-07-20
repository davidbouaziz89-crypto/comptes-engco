-- Compta : mois/année que le frais concerne (distinct de la date d'ajout). Format 'YYYY-MM'.
alter table public.engco_frais add column if not exists mois_concerne text;
alter table public.velo_frais  add column if not exists mois_concerne text;
