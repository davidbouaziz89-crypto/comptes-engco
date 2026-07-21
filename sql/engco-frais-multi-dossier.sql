-- Frais LED : une facture peut concerner PLUSIEURS dossiers (liste d'ID CRM).
-- Nouvelle colonne tableau. L'ancienne "dossier_crm_id" reste (= 1er ID, compat + rattachement simple).
-- Idempotent. À lancer dans Supabase → SQL Editor.
alter table if exists engco_frais add column if not exists dossier_crm_ids text[];

-- Reprise : initialise la liste avec l'ID unique existant là où c'est vide.
update engco_frais
   set dossier_crm_ids = array[dossier_crm_id]
 where dossier_crm_id is not null and dossier_crm_id <> '' and (dossier_crm_ids is null or array_length(dossier_crm_ids,1) is null);
