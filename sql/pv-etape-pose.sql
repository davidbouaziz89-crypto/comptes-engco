-- CRM Photovoltaïque — Étape « Envoi en pose » (installation)
-- 6e étape du parcours (après Financement, avant Terminé).
-- Gérée par le rôle « financement » : date + heure d'installation + commentaire.
-- Un planning hebdomadaire des installations est visible (onglet 🚚 Poses, admin + financement).
alter table public.pv_leads
  add column if not exists pose_date       date,
  add column if not exists pose_heure      text,
  add column if not exists pose_commentaire text;

-- Aucune nouvelle table : l'étape réutilise pv_leads.stage = 'pose'.
