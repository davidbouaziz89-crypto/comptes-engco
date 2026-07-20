-- ============================================================
-- COMPTA LED — toutes les migrations à exécuter (idempotent)
-- À coller d'un bloc dans le SQL Editor de unified-backend.
-- ============================================================


-- ===== engco-frais-dossier.sql =====
-- Compta LED — lier un frais à un dossier via l'ID CRM du dossier (engco_dossiers.crm_id)
alter table public.engco_frais
  add column if not exists dossier_crm_id text;

-- ===== engco-frais-mois.sql =====
-- Compta : mois/année que le frais concerne (distinct de la date d'ajout). Format 'YYYY-MM'.
alter table public.engco_frais add column if not exists mois_concerne text;
alter table public.velo_frais  add column if not exists mois_concerne text;

-- ===== engco-frais-auto.sql =====
-- Compta : marque un frais généré automatiquement (récurrent) vs saisi à la main
alter table public.engco_frais add column if not exists auto boolean not null default false;
alter table public.velo_frais  add column if not exists auto boolean not null default false;

-- ===== engco-categories-documents.sql =====
-- Compta : catégories de frais configurables + justificatifs (documents) sur les frais LED

-- Catégories de frais / dépenses (par projet : engco_ pour LED, velo_ pour Vélo)
create table if not exists public.engco_frais_cats (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.velo_frais_cats (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now()
);
-- RLS : mêmes règles que les autres tables du projet (accès authentifié)
alter table public.engco_frais_cats enable row level security;
alter table public.velo_frais_cats enable row level security;
drop policy if exists engco_frais_cats_all on public.engco_frais_cats;
create policy engco_frais_cats_all on public.engco_frais_cats for all to authenticated using (true) with check (true);
drop policy if exists velo_frais_cats_all on public.velo_frais_cats;
create policy velo_frais_cats_all on public.velo_frais_cats for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.engco_frais_cats to authenticated;
grant select, insert, update, delete on public.velo_frais_cats to authenticated;

-- Justificatif attaché à un frais LED
alter table public.engco_frais
  add column if not exists doc_path text,
  add column if not exists doc_name text;

-- Bucket de stockage des justificatifs (privé)
insert into storage.buckets (id, name, public) values ('engco-docs','engco-docs',false)
on conflict (id) do nothing;

drop policy if exists engco_docs_read on storage.objects;
create policy engco_docs_read on storage.objects for select to authenticated using (bucket_id='engco-docs');
drop policy if exists engco_docs_insert on storage.objects;
create policy engco_docs_insert on storage.objects for insert to authenticated with check (bucket_id='engco-docs');
drop policy if exists engco_docs_delete on storage.objects;
create policy engco_docs_delete on storage.objects for delete to authenticated using (bucket_id='engco-docs');

-- ===== engco-delegataires.sql =====
-- Délégataires CEE + leurs fiches (taux propre à chaque délégataire) — projet LED
create table if not exists public.engco_delegataires (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.engco_delegataire_fiches (
  id uuid primary key default gen_random_uuid(),
  delegataire_id uuid not null references public.engco_delegataires(id) on delete cascade,
  nom text not null,
  taux numeric not null default 0,
  created_at timestamptz not null default now()
);

-- RLS : accès authentifié (comme les autres tables du projet)
alter table public.engco_delegataires enable row level security;
alter table public.engco_delegataire_fiches enable row level security;
drop policy if exists engco_deleg_all on public.engco_delegataires;
create policy engco_deleg_all on public.engco_delegataires for all to authenticated using (true) with check (true);
drop policy if exists engco_deleg_fiches_all on public.engco_delegataire_fiches;
create policy engco_deleg_fiches_all on public.engco_delegataire_fiches for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.engco_delegataires to authenticated;
grant select, insert, update, delete on public.engco_delegataire_fiches to authenticated;

-- Lien du dossier LED vers un délégataire + une fiche CEE (taux figé à l'enregistrement)
alter table public.engco_dossiers
  add column if not exists delegataire_id uuid,
  add column if not exists fiche_id uuid,
  add column if not exists fiche_taux numeric;

-- ===== engco-cumac.sql =====
-- Volume CEE (kWh cumac) sur le dossier LED
alter table public.engco_dossiers add column if not exists cumac numeric;
