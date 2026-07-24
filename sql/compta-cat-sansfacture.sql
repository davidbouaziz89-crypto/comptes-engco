-- =====================================================================
-- Catégories « sans facture » : frais récurrents qui n'ont jamais de
-- justificatif (frais bancaires, salaires, mutuelle, prévoyance, URSSAF…).
-- Les lignes de relevé classées dans une telle catégorie sont comptées
-- comme justifiées et n'apparaissent plus dans « à rapprocher ».
-- =====================================================================
alter table compta_categories add column if not exists no_invoice boolean not null default false;
