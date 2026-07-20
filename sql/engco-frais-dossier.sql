-- Compta LED — lier un frais à un dossier via l'ID CRM du dossier (engco_dossiers.crm_id)
alter table public.engco_frais
  add column if not exists dossier_crm_id text;
