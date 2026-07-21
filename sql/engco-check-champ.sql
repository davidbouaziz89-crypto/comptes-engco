-- Check LED : un élément à vérifier peut être lié à un CHAMP de coût du dossier.
-- Si ce coût vaut 0 pour un dossier, la case se coche automatiquement (rien à faire).
-- Idempotent. À lancer dans Supabase → SQL Editor.
alter table if exists engco_check_items add column if not exists champ text;
