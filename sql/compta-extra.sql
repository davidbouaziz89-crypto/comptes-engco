-- =====================================================================
-- Extensions : catégorie + invités sur les factures, société Elion Capital,
-- catégorie Restaurant (globale, disponible pour toutes les sociétés).
-- =====================================================================
alter table compta_invoices add column if not exists category_id uuid references compta_categories(id) on delete set null;
alter table compta_invoices add column if not exists guests text;

-- Nouvelle société
insert into compta_companies (name, vat_regime, default_vat_rate, color)
select 'Elion Capital', 'reel_mensuel', 20.00, '#7a5cff'
where not exists (select 1 from compta_companies where name = 'Elion Capital');

-- Catégorie Restaurant (globale) : sert de déclencheur au champ « Invités »
insert into compta_categories (company_id, name, flow, vat_recoverable, default_vat_rate)
select null, 'Restaurant', 'achat', true, 10.00
where not exists (select 1 from compta_categories where company_id is null and name = 'Restaurant');
