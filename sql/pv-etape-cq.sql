-- CRM Photovoltaïque — Étape « Contrôle Qualité » (CQ)
-- Nouvelle étape du parcours (après Commercial, avant Terminé).
-- Le contrôleur qualité y met un statut et un commentaire, puis valide.
alter table public.pv_leads
  add column if not exists cq_statut     text,   -- 'CQ OK' | 'À travailler' | 'MORT' | 'Dossier envoyé'
  add column if not exists cq_commentaire text;

-- Rappel : owner_cq / rdv_cq_date / rdv_cq_heure existent déjà (voir sql/pv-cq.sql).
-- Aucune nouvelle table : l'étape CQ réutilise pv_leads.stage = 'cq'.
