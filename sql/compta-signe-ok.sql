-- =====================================================================
-- Marqueur « signe vérifié / correct » sur une ligne de relevé.
-- Quand David valide une ligne signalée dans « Signes à vérifier »,
-- on la marque OK pour qu'elle ne réapparaisse plus dans l'audit.
-- =====================================================================
alter table compta_transactions add column if not exists sign_ok boolean not null default false;
