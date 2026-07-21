-- Dossiers LED : ajoute le champ "Contact client" (le nom du client devient "Raison sociale").
-- Idempotent.
alter table if exists engco_dossiers add column if not exists contact_client text;
