-- =====================================================================
-- Comptes / cartes par société : chaque société a un « Compte principal »
-- (banque) et peut avoir des cartes à relevé séparé (Amex, carte bleue…).
-- À l'import, on choisit le compte ; tout reste rattaché à la société
-- (TVA, rapprochement) mais séparé et filtrable par compte.
-- + Entité « Perso » (mêmes outils, sans TVA).
-- =====================================================================
create table if not exists compta_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references compta_companies(id) on delete cascade,
  name        text not null,
  type        text not null default 'banque',   -- 'banque' | 'carte'
  created_at  timestamptz not null default now()
);
create index if not exists idx_compta_accounts_company on compta_accounts(company_id);
alter table compta_accounts enable row level security;
drop policy if exists compta_accounts_rw on compta_accounts;
create policy compta_accounts_rw on compta_accounts for all
  using (public.compta_has_access(company_id))
  with check (public.compta_has_access(company_id));

-- Rattachement des lignes de relevé et des relevés importés à un compte
alter table compta_transactions   add column if not exists account_id uuid references compta_accounts(id) on delete set null;
alter table compta_bank_statements add column if not exists account_id uuid references compta_accounts(id) on delete set null;

-- Entité personnelle : mêmes outils, onglet TVA masqué
alter table compta_companies add column if not exists is_personal boolean not null default false;

-- Un « Compte principal » pour chaque société existante…
insert into compta_accounts (company_id, name, type)
select c.id, 'Compte principal', 'banque' from compta_companies c
where not exists (select 1 from compta_accounts a where a.company_id = c.id);

-- …puis on y rattache tout l'existant (lignes + relevés)
update compta_transactions t set account_id = a.id
from compta_accounts a
where a.company_id = t.company_id and a.type = 'banque' and t.account_id is null;

update compta_bank_statements s set account_id = a.id
from compta_accounts a
where a.company_id = s.company_id and a.type = 'banque' and s.account_id is null;

-- Société « Perso » (sans TVA) + son compte principal
insert into compta_companies (name, vat_regime, default_vat_rate, is_personal, color)
select 'Perso', 'franchise', 0, true, '#64748b'
where not exists (select 1 from compta_companies where name = 'Perso');

insert into compta_accounts (company_id, name, type)
select c.id, 'Compte principal', 'banque' from compta_companies c
where c.name = 'Perso' and not exists (select 1 from compta_accounts a where a.company_id = c.id);
