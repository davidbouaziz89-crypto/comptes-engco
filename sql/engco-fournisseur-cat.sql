-- Un fournisseur est relié à une catégorie de frais (auto-remplissage de la catégorie)
alter table public.engco_fournisseurs add column if not exists categorie text;
