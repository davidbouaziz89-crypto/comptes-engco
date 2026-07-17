-- CRM PV : la catégorie "pack" devient "pac" (pompe à chaleur)
update public.pv_produits set categorie='pac' where categorie='pack';
