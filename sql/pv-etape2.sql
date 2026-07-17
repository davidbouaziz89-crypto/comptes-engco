-- CRM Photovoltaïque — Étape 2 (Confirmateur)
-- Rôles multiples par utilisateur : un télépro peut aussi être confirmateur, etc.
alter table public.pv_profiles
  add column if not exists roles jsonb not null default '[]'::jsonb;  -- ex: ["telepro","confirmateur"]

-- Le confirmateur a revalidé les infos de qualification saisies en étape 1
alter table public.pv_leads
  add column if not exists infos_confirmees boolean;
