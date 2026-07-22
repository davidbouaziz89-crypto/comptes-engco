-- Frais LED : numéro de facture (facultatif) + détection de doublon par ce numéro.
-- Idempotent. À lancer dans Supabase → SQL Editor.
alter table if exists engco_frais add column if not exists numero_facture text;
