-- Infos récurrent sur le fournisseur : montant habituel + société qui paie
alter table public.engco_fournisseurs
  add column if not exists montant numeric,
  add column if not exists source_id uuid;
