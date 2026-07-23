-- =====================================================================
-- Registre des TIERS (clients / fournisseurs) par société.
-- Alimenté automatiquement : quand David saisit un tiers ou quand l'IA
-- en détecte un à l'import, il est enregistré ici avec sa provenance
-- (manuel / ia). Sert au registre dans Paramètres et à l'onglet Tiers.
-- =====================================================================
create table if not exists compta_tiers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references compta_companies(id) on delete cascade,
  name        text not null,               -- nom affiché
  name_key    text not null,               -- lower(trim(name)) pour l'unicité
  source      text not null default 'manuel',  -- 'manuel' | 'ia'
  created_at  timestamptz not null default now(),
  unique (company_id, name_key)
);
create index if not exists idx_compta_tiers_company on compta_tiers(company_id);

alter table compta_tiers enable row level security;
drop policy if exists compta_tiers_rw on compta_tiers;
create policy compta_tiers_rw on compta_tiers for all
  using (public.compta_has_access(company_id))
  with check (public.compta_has_access(company_id));
