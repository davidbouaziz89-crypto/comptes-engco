-- Champs additionnels sur les matériels (prix HT, puissance, marque)
alter table public.engco_materiels
  add column if not exists prix_ht numeric,
  add column if not exists puissance text,
  add column if not exists marque text;
