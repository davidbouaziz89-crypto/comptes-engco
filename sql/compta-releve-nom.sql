-- =====================================================================
-- Nom personnalisé pour un relevé importé (ex. « Amex janv. 2026 »).
-- Sert à trier / regrouper les lignes par relevé dans l'onglet Relevés.
-- =====================================================================
alter table compta_bank_statements add column if not exists label text;
