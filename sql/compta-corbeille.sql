-- =====================================================================
-- Corbeille des factures (suppression douce). Une facture supprimée est
-- marquée deleted_at au lieu d'être effacée ; l'app la conserve 30 jours
-- (restauration possible) puis la purge automatiquement.
-- =====================================================================
alter table compta_invoices add column if not exists deleted_at timestamptz;
create index if not exists idx_compta_inv_deleted on compta_invoices(deleted_at);
