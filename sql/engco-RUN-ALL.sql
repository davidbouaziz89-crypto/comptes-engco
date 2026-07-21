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

-- ===== engco-check.sql =====
-- Check-list de dossiers (LED) : éléments à cocher paramétrables + état par dossier
-- Un élément peut être lié à une catégorie de frais : dès qu'un frais de cette
-- catégorie est rattaché au dossier (par son ID CRM), la case se coche toute seule.
create table if not exists public.engco_check_items (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  categorie text,                 -- catégorie de frais qui coche automatiquement (optionnel)
  ordre int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.engco_check_state (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.engco_dossiers(id) on delete cascade,
  item_id uuid not null references public.engco_check_items(id) on delete cascade,
  checked boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (dossier_id, item_id)
);

alter table public.engco_check_items enable row level security;
alter table public.engco_check_state enable row level security;
drop policy if exists engco_check_items_all on public.engco_check_items;
create policy engco_check_items_all on public.engco_check_items for all to authenticated using (true) with check (true);
drop policy if exists engco_check_state_all on public.engco_check_state;
create policy engco_check_state_all on public.engco_check_state for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.engco_check_items to authenticated;
grant select, insert, update, delete on public.engco_check_state to authenticated;

-- ===== engco-materiel-fournisseurs.sql =====
-- Matériels + fournisseurs paramétrables (projet LED) + lignes matériel par dossier
create table if not exists public.engco_materiels (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.engco_fournisseurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now()
);
-- Plusieurs matériels par dossier : quantité livrée + quantité valorisée
create table if not exists public.engco_dossier_materiels (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.engco_dossiers(id) on delete cascade,
  materiel_id uuid,
  qte_livree numeric not null default 0,
  qte_valorisee numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.engco_materiels enable row level security;
alter table public.engco_fournisseurs enable row level security;
alter table public.engco_dossier_materiels enable row level security;
drop policy if exists engco_materiels_all on public.engco_materiels;
create policy engco_materiels_all on public.engco_materiels for all to authenticated using (true) with check (true);
drop policy if exists engco_fournisseurs_all on public.engco_fournisseurs;
create policy engco_fournisseurs_all on public.engco_fournisseurs for all to authenticated using (true) with check (true);
drop policy if exists engco_dossier_materiels_all on public.engco_dossier_materiels;
create policy engco_dossier_materiels_all on public.engco_dossier_materiels for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.engco_materiels to authenticated;
grant select, insert, update, delete on public.engco_fournisseurs to authenticated;
grant select, insert, update, delete on public.engco_dossier_materiels to authenticated;

-- ===== engco-materiel-champs.sql =====
-- Champs additionnels sur les matériels (prix HT, puissance, marque)
alter table public.engco_materiels
  add column if not exists prix_ht numeric,
  add column if not exists puissance text,
  add column if not exists marque text;

-- ===== engco-fournisseur-cat.sql =====
-- Un fournisseur est relié à une catégorie de frais (auto-remplissage de la catégorie)
alter table public.engco_fournisseurs add column if not exists categorie text;

-- ===== engco-campagnes.sql =====
-- Campagnes paramétrables + campagne sur le dossier (LED)
create table if not exists public.engco_campagnes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now()
);
alter table public.engco_campagnes enable row level security;
drop policy if exists engco_campagnes_all on public.engco_campagnes;
create policy engco_campagnes_all on public.engco_campagnes for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.engco_campagnes to authenticated;
alter table public.engco_dossiers add column if not exists campagne text;

-- ===== engco-fournisseur-type.sql =====
-- Type du fournisseur : dépense ou récurrent (le choix récurrent/dépense passe au niveau du fournisseur)
alter table public.engco_fournisseurs add column if not exists type text not null default 'depense';

-- ===== engco-depots.sql =====
-- Dépôts Emmy paramétrables, chacun relié à un délégataire (LED)
create table if not exists public.engco_depots (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  delegataire_id uuid,
  created_at timestamptz not null default now()
);
alter table public.engco_depots enable row level security;
drop policy if exists engco_depots_all on public.engco_depots;
create policy engco_depots_all on public.engco_depots for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.engco_depots to authenticated;

-- ===== engco-fournisseur-recurrent.sql =====
-- Infos récurrent sur le fournisseur : montant habituel + société qui paie
alter table public.engco_fournisseurs
  add column if not exists montant numeric,
  add column if not exists source_id uuid;

-- ===== engco-fournisseur-moisdebut.sql =====
-- Date de début (mois) pour les fournisseurs récurrents
alter table public.engco_fournisseurs add column if not exists mois_debut text;

-- ===== engco-contact-client.sql =====
alter table if exists engco_dossiers add column if not exists contact_client text;

-- ===== engco-fournisseur-categories.sql =====
alter table if exists engco_fournisseurs add column if not exists categories text[];
update engco_fournisseurs set categories = array[categorie] where categorie is not null and categorie <> '' and (categories is null or array_length(categories,1) is null);
