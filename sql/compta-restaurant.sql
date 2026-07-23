-- =====================================================================
-- Repas d'affaires (restaurant) : convives + nombre de repas.
-- Alimente le registre « Repas d'affaires » dans Paramètres.
-- guests existe déjà sur compta_invoices (voir compta-extra.sql) ;
-- on l'ajoute aux lignes de relevé, et on ajoute meals (nb de couverts)
-- aux deux tables.
-- =====================================================================
alter table compta_transactions add column if not exists guests text;
alter table compta_transactions add column if not exists meals   int;
alter table compta_invoices     add column if not exists meals   int;
