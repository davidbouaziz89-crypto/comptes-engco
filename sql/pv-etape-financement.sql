-- CRM Photovoltaïque — Étape « Financement »
-- Nouvelle étape du parcours (après Contrôle Qualité, avant Terminé).
-- Un rôle « financement » y met un statut (ACCEPTÉ / REFUSÉ / EN ATTENTE) et un commentaire, puis valide.
alter table public.pv_leads
  add column if not exists financement_statut     text,   -- 'ACCEPTÉ' | 'REFUSÉ' | 'EN ATTENTE'
  add column if not exists financement_commentaire text;

-- Aucune nouvelle table : l'étape réutilise pv_leads.stage = 'financement'.
