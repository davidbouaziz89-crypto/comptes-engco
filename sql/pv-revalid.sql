-- CRM Photovoltaïque — Étape 2 : mémorise quelles infos le confirmateur a revalidées
-- ex: {"age":true,"situation_familiale":true,...}
alter table public.pv_leads
  add column if not exists revalid jsonb not null default '{}'::jsonb;
