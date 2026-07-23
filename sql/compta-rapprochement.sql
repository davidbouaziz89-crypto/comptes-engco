-- =====================================================================
-- Rapprochement avancé : une facture peut être reliée à PLUSIEURS lignes
-- de relevé (ex. payée en 2 virements), éventuellement dans une autre
-- société (paiement fait avec une autre entité).
-- Source de vérité = table de liaison. transaction_id est conservé
-- (synchronisé sur le 1er lien) pour compatibilité avec l'existant.
-- =====================================================================
create table if not exists compta_invoice_links (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references compta_invoices(id) on delete cascade,
  transaction_id uuid not null references compta_transactions(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (invoice_id, transaction_id)
);
create index if not exists idx_compta_ilinks_inv on compta_invoice_links(invoice_id);
create index if not exists idx_compta_ilinks_tx  on compta_invoice_links(transaction_id);

alter table compta_invoice_links enable row level security;
drop policy if exists compta_ilinks_rw on compta_invoice_links;
create policy compta_ilinks_rw on compta_invoice_links for all
  using (exists (select 1 from compta_invoices v
                 where v.id = invoice_id and public.compta_has_access(v.company_id)))
  with check (exists (select 1 from compta_invoices v
                      where v.id = invoice_id and public.compta_has_access(v.company_id)));

-- Nouveau statut « partiel » (somme des lignes reliées < TTC).
alter table compta_invoices drop constraint if exists compta_invoices_status_check;
alter table compta_invoices add constraint compta_invoices_status_check
  check (status in ('a_rapprocher','partiel','rapproche'));
