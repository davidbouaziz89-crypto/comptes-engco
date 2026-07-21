-- =====================================================================
-- COMPTA MULTI-SOCIÉTÉS — intégré au portail comptes-engco (unified-backend)
-- Tables préfixées compta_. Admin = rôle 'admin' dans app_memberships.
-- Accès par société via compta_company_access. RLS stricte.
-- =====================================================================
create extension if not exists "pgcrypto";

-- ---------- Sociétés ----------
create table if not exists compta_companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  logo_key         text,              -- ex. 'notelia' -> assets/logos/notelia.png
  color            text,              -- couleur d'accent de la société (hex)
  siren            text,
  vat_regime       text not null default 'reel_mensuel'
                   check (vat_regime in ('reel_mensuel','reel_trimestriel','franchise')),
  default_vat_rate numeric(5,2) not null default 20.00,
  currency         text not null default 'EUR',
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------- Accès par société (cloisonnement) ----------
create table if not exists compta_company_access (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references compta_companies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text,
  role       text not null check (role in ('secretaire','comptable')),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index if not exists idx_compta_access_user on compta_company_access(user_id);

-- ---------- Catégories ----------
create table if not exists compta_categories (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references compta_companies(id) on delete cascade,
  name             text not null,
  flow             text not null default 'achat' check (flow in ('achat','vente','both')),
  vat_recoverable  boolean not null default true,
  default_vat_rate numeric(5,2),
  created_at       timestamptz not null default now()
);
create index if not exists idx_compta_cat_company on compta_categories(company_id);

-- ---------- Relevés ----------
create table if not exists compta_bank_statements (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references compta_companies(id) on delete cascade,
  bank_name         text,
  period_month      date,
  original_filename text,
  storage_path      text,
  uploaded_by       uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

-- ---------- Transactions ----------
create table if not exists compta_transactions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references compta_companies(id) on delete cascade,
  statement_id  uuid references compta_bank_statements(id) on delete set null,
  op_date       date not null,
  label         text not null,
  amount        numeric(12,2) not null,
  category_id   uuid references compta_categories(id) on delete set null,
  counterparty  text,
  vat_rate      numeric(5,2),
  vat_amount    numeric(12,2),
  status        text not null default 'a_classer' check (status in ('a_classer','classe')),
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_compta_tx_company_date on compta_transactions(company_id, op_date);

-- ---------- Factures ----------
create table if not exists compta_invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references compta_companies(id) on delete cascade,
  direction         text not null default 'achat' check (direction in ('achat','vente')),
  counterparty      text,
  invoice_number    text,
  invoice_date      date,
  amount_ht         numeric(12,2),
  vat_amount        numeric(12,2),
  amount_ttc        numeric(12,2),
  vat_rate          numeric(5,2),
  storage_path      text,
  original_filename text,
  transaction_id    uuid references compta_transactions(id) on delete set null,
  status            text not null default 'a_rapprocher' check (status in ('a_rapprocher','rapproche')),
  uploaded_by       uuid references auth.users(id),
  created_at        timestamptz not null default now()
);
create index if not exists idx_compta_inv_company on compta_invoices(company_id);
create index if not exists idx_compta_inv_tx on compta_invoices(transaction_id);

-- =====================================================================
-- Helpers de sécurité (branchés sur app_memberships du portail)
-- =====================================================================
create or replace function public.compta_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_memberships where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.compta_has_access(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.compta_is_admin()
      or exists (select 1 from compta_company_access where company_id = cid and user_id = auth.uid());
$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table compta_companies       enable row level security;
alter table compta_company_access  enable row level security;
alter table compta_categories      enable row level security;
alter table compta_bank_statements enable row level security;
alter table compta_transactions    enable row level security;
alter table compta_invoices        enable row level security;

drop policy if exists compta_companies_read on compta_companies;
create policy compta_companies_read on compta_companies for select using (public.compta_has_access(id));
drop policy if exists compta_companies_write on compta_companies;
create policy compta_companies_write on compta_companies for all using (public.compta_is_admin()) with check (public.compta_is_admin());

drop policy if exists compta_ca_read on compta_company_access;
create policy compta_ca_read on compta_company_access for select using (user_id = auth.uid() or public.compta_is_admin());
drop policy if exists compta_ca_write on compta_company_access;
create policy compta_ca_write on compta_company_access for all using (public.compta_is_admin()) with check (public.compta_is_admin());

drop policy if exists compta_cat_rw on compta_categories;
create policy compta_cat_rw on compta_categories for all
  using (company_id is null or public.compta_has_access(company_id))
  with check ((company_id is null and public.compta_is_admin()) or public.compta_has_access(company_id));

drop policy if exists compta_stmt_rw on compta_bank_statements;
create policy compta_stmt_rw on compta_bank_statements for all
  using (public.compta_has_access(company_id)) with check (public.compta_has_access(company_id));

drop policy if exists compta_tx_rw on compta_transactions;
create policy compta_tx_rw on compta_transactions for all
  using (public.compta_has_access(company_id)) with check (public.compta_has_access(company_id));

drop policy if exists compta_inv_rw on compta_invoices;
create policy compta_inv_rw on compta_invoices for all
  using (public.compta_has_access(company_id)) with check (public.compta_has_access(company_id));

-- =====================================================================
-- Vue TVA mensuelle
-- =====================================================================
create or replace view compta_tva_mensuelle
with (security_invoker = true) as
select
  t.company_id,
  date_trunc('month', t.op_date)::date as mois,
  sum(case when t.amount > 0 then coalesce(t.vat_amount,0) else 0 end) as tva_collectee,
  sum(case when t.amount < 0 and coalesce(c.vat_recoverable, true) then coalesce(t.vat_amount,0) else 0 end) as tva_deductible,
  sum(case when t.amount > 0 then coalesce(t.vat_amount,0) else 0 end)
    - sum(case when t.amount < 0 and coalesce(c.vat_recoverable, true) then coalesce(t.vat_amount,0) else 0 end) as tva_nette
from compta_transactions t
left join compta_categories c on c.id = t.category_id
group by t.company_id, date_trunc('month', t.op_date);

-- ---------- Storage : bucket privé compta-documents ----------
insert into storage.buckets (id, name, public) values ('compta-documents','compta-documents',false)
on conflict (id) do nothing;

create or replace function public.compta_storage_company_id(objname text)
returns uuid language sql immutable as $$ select nullif(split_part(objname,'/',1),'')::uuid; $$;

drop policy if exists compta_docs_read on storage.objects;
create policy compta_docs_read on storage.objects for select
  using (bucket_id='compta-documents' and public.compta_has_access(public.compta_storage_company_id(name)));
drop policy if exists compta_docs_insert on storage.objects;
create policy compta_docs_insert on storage.objects for insert
  with check (bucket_id='compta-documents' and public.compta_has_access(public.compta_storage_company_id(name)));
drop policy if exists compta_docs_delete on storage.objects;
create policy compta_docs_delete on storage.objects for delete
  using (bucket_id='compta-documents' and public.compta_is_admin());

-- ---------- Catégories globales par défaut ----------
insert into compta_categories (company_id, name, flow, vat_recoverable, default_vat_rate) values
  (null,'Téléphonie / Internet','achat',true,20.00),
  (null,'Loyer','achat',true,20.00),
  (null,'Fournitures','achat',true,20.00),
  (null,'Carburant','achat',true,20.00),
  (null,'Restauration','achat',true,10.00),
  (null,'Honoraires / Comptable','achat',true,20.00),
  (null,'Assurance','achat',false,0.00),
  (null,'Banque / Frais bancaires','achat',false,0.00),
  (null,'Salaires / URSSAF','achat',false,0.00),
  (null,'Ventes / Prestations','vente',true,20.00)
on conflict do nothing;
