-- CRM Photovoltaïque — adresse du domicile des utilisateurs (surtout commerciaux)
-- Sert à calculer la distance domicile → 1er RDV du jour dans le planning.
alter table public.pv_profiles
  add column if not exists adresse       text,
  add column if not exists code_postal   text,
  add column if not exists ville         text,
  add column if not exists lat           numeric,
  add column if not exists lng           numeric;
