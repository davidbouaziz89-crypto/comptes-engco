-- CRM PV : prix de vente TTC en plus du prix de cession (HT = prix_ht)
alter table public.pv_produits
  add column if not exists prix_vente_ttc numeric;
