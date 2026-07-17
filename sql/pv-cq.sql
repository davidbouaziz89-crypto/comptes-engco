-- CRM Photovoltaïque — RDV Contrôle Qualité (CQ) placé par le commercial
alter table public.pv_leads
  add column if not exists owner_cq     uuid,   -- utilisateur de rôle CQ
  add column if not exists rdv_cq_date  date,
  add column if not exists rdv_cq_heure text;
