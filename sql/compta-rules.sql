-- =====================================================================
-- Apprentissage : règles apprises des corrections de David.
-- Quand il classe un libellé/tiers dans une catégorie, on mémorise ici ;
-- les prochains imports appliquent la règle automatiquement.
-- =====================================================================
create table if not exists compta_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references compta_companies(id) on delete cascade,
  pattern     text not null,   -- déclencheur en minuscules (souvent le tiers, ou un mot-clé du libellé)
  category_id uuid references compta_categories(id) on delete cascade,
  counterparty text,           -- tiers à appliquer automatiquement
  updated_at  timestamptz not null default now(),
  unique (company_id, pattern)
);
create index if not exists idx_compta_rules_company on compta_rules(company_id);

alter table compta_rules enable row level security;
drop policy if exists compta_rules_rw on compta_rules;
create policy compta_rules_rw on compta_rules for all
  using (public.compta_has_access(company_id))
  with check (public.compta_has_access(company_id));
