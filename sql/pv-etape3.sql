-- CRM Photovoltaïque — Étape 3 (Commercial) : rapport de vente
-- Réutilise : montant (= prix de vente), mode_chauffage (existants).
alter table public.pv_leads
  add column if not exists rapport               text,
  add column if not exists materiel              jsonb not null default '[]'::jsonb, -- [{id,nom,categorie,qte}]
  add column if not exists aides                 jsonb not null default '[]'::jsonb, -- [{label,montant}]
  add column if not exists conso_client          numeric,
  add column if not exists orientation_toiture   text,
  add column if not exists financement_mode      text,      -- 'comptant' | 'financement'
  add column if not exists financeur             text,
  add column if not exists financement_duree     int,       -- années
  add column if not exists dossier_complet       boolean,
  add column if not exists docs_manquants        text,
  add column if not exists horaire_cq            text,
  add column if not exists commentaire_commercial text;
