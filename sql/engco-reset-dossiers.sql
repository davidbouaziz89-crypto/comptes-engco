-- ⚠️ DESTRUCTIF — supprime TOUS les dossiers LED (engco_dossiers) et leurs matériels.
-- N'affecte PAS les frais, apports, récupérations, ni les dossiers Vélo (velo_dossiers).
-- À lancer dans Supabase → SQL Editor, puis refaire l'import.

-- 1) matériels rattachés aux dossiers (au cas où pas de cascade)
delete from engco_dossier_materiels;

-- 2) les dossiers eux-mêmes
delete from engco_dossiers;
