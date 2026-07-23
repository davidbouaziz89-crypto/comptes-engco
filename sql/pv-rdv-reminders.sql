-- CRM PV — rappels de RDV : marqueurs "notifié 30 min avant" (anti-doublon)
alter table public.pv_leads add column if not exists rdv_conf_notif timestamptz; -- appel confirmateur
alter table public.pv_leads add column if not exists rdv_notif      timestamptz; -- RDV commercial
