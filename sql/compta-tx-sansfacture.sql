-- =====================================================================
-- Marquage « sans facture » au niveau d'UNE ligne de relevé (paiement)
-- — en plus du réglage par catégorie. Permet de dire, depuis le
-- rapprochement : « cette ligne, catégorie X, et c'est sans facture ».
-- =====================================================================
alter table compta_transactions add column if not exists no_invoice boolean not null default false;
