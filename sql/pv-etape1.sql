-- CRM Photovoltaïque — Étape 1 (Télépro) : champs de qualification client
-- Conso élec réutilise la colonne existante montant_facture (€/mois).
alter table public.pv_leads
  add column if not exists age                 int,
  add column if not exists type_chauffage      text,            -- 'elec' | 'gaz' | 'both'
  add column if not exists conso_gaz            numeric,         -- conso gaz €/mois (conso élec = montant_facture)
  add column if not exists situation_familiale  text,            -- Marié / Pacsé / Divorcé / Célibataire / Veuf / Concubinage
  add column if not exists nb_enfants           int,
  add column if not exists statut_pro           text,            -- CDI / CDD / Indépendant / Retraité / Sans activité
  add column if not exists zone_abh             boolean,         -- maison en zone ABH (oui/non)
  add column if not exists credits              jsonb not null default '[]'::jsonb,  -- [{"label":"...","montant":123}]
  add column if not exists disponibilite        text,            -- dispo du client pour le rappel du confirmateur
  add column if not exists rdv_conf_date        date,            -- date du rappel confirmateur (planning confirmateur)
  add column if not exists rdv_conf_heure       text;            -- heure du rappel confirmateur
