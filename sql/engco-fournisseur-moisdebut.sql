-- Date de début (mois) pour les fournisseurs récurrents
alter table public.engco_fournisseurs add column if not exists mois_debut text;
