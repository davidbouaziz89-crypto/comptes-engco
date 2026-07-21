-- Fournisseurs LED : un fournisseur peut appartenir à PLUSIEURS catégories.
-- Nouvelle colonne tableau (text[]). L'ancienne colonne "categorie" reste (= 1re catégorie, compat).
-- Idempotent. À lancer dans Supabase → SQL Editor.
alter table if exists engco_fournisseurs add column if not exists categories text[];

-- Reprise : initialise "categories" avec l'ancienne catégorie unique là où c'est vide.
update engco_fournisseurs
   set categories = array[categorie]
 where categorie is not null and categorie <> '' and (categories is null or array_length(categories,1) is null);
