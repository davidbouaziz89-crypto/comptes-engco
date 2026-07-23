-- =====================================================================
-- Ajoute une CATÉGORIE (facultative) à chaque tiers du registre.
-- Permet de rattacher un client/fournisseur à une catégorie comptable
-- depuis Paramètres → Tiers et l'onglet Tiers.
-- =====================================================================
alter table compta_tiers
  add column if not exists category_id uuid references compta_categories(id) on delete set null;
