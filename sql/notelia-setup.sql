-- ============================================================
-- NOTELIA (CRM Télécom) — schéma complet, à coller d'un bloc
-- dans le SQL Editor de unified-backend (projet lrslisyydbiejqzpsoxc).
-- Idempotent : peut être ré-exécuté sans danger.
--
-- Principe : les tables « génériques » (frais, apports, sources,
-- remboursements, récurrents, catégories) sont COPIÉES à l'identique
-- depuis les tables existantes LED/Vélo — colonnes calculées incluses —
-- pour garder EXACTEMENT le même fonctionnement. Seuls les DOSSIERS et
-- les LEASEURS sont propres au télécom.
-- Préfixe des tables : nt_   ·   project_key : 'notelia'
-- ============================================================

-- ---------- 1) Tables génériques copiées (structure identique) ----------
create table if not exists public.nt_frais          (like public.engco_frais          including all);
create table if not exists public.nt_frais_cats     (like public.engco_frais_cats     including all);
create table if not exists public.nt_recurrents     (like public.engco_recurrents     including all);
create table if not exists public.nt_sources        (like public.velo_sources         including all);
create table if not exists public.nt_apports        (like public.velo_apports         including all);
create table if not exists public.nt_remboursements (like public.engco_remboursements  including all);

-- ---------- 2) Leaseurs (sociétés de leasing) ----------
create table if not exists public.nt_leaseurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now()
);

-- ---------- 3) Dossiers télécom ----------
-- Catégories métier : mois offert, rachat, montant financé, FAS, facture,
-- facturation mensuel/annuel, campagne (source du lead), leaseur.
-- Marges calculées automatiquement (colonnes générées) :
--   marge brute  = montant financé + FAS − rachat
--   commission   = montant financé × % campagne
--   part manager = marge brute × % manager
--   marge nette  = marge brute − part manager − commission
create table if not exists public.nt_dossiers (
  id uuid primary key default gen_random_uuid(),
  date date default current_date,
  nom_client text,
  crm_id text,
  numero_depot text,
  adresse text,
  code_postal text,
  ville text,
  telephone text,
  email text,
  statut text default 'En cours',
  commercial_regie text,                 -- campagne (source du lead)
  regie_pct numeric default 0,           -- % de commission de la campagne
  david_pct numeric default 0,           -- % manager (0 par défaut)
  leaseur_id uuid,
  facturation text default 'mensuel',    -- 'mensuel' | 'annuel'
  montant_finance numeric default 0,
  fas numeric default 0,
  rachat numeric default 0,
  mois_offert integer default 0,
  facture numeric default 0,
  created_at timestamptz not null default now(),
  -- colonnes calculées (lues telles quelles par l'appli) :
  montant_prime    numeric generated always as (coalesce(montant_finance,0)) stored,
  marge_brute      numeric generated always as (coalesce(montant_finance,0)+coalesce(fas,0)-coalesce(rachat,0)) stored,
  cout_david       numeric generated always as ((coalesce(montant_finance,0)+coalesce(fas,0)-coalesce(rachat,0))*coalesce(david_pct,0)/100) stored,
  commission_regie numeric generated always as (coalesce(montant_finance,0)*coalesce(regie_pct,0)/100) stored,
  marge_nette      numeric generated always as (
      (coalesce(montant_finance,0)+coalesce(fas,0)-coalesce(rachat,0))
      - (coalesce(montant_finance,0)+coalesce(fas,0)-coalesce(rachat,0))*coalesce(david_pct,0)/100
      - coalesce(montant_finance,0)*coalesce(regie_pct,0)/100
    ) stored
);

-- ---------- 4) RLS + droits (accès authentifié, comme LED/Vélo) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'nt_frais','nt_frais_cats','nt_recurrents','nt_sources','nt_apports',
    'nt_remboursements','nt_leaseurs','nt_dossiers'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true);', t||'_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;

-- ---------- 5) Statuts par défaut (project_key = 'notelia') ----------
insert into public.app_statuts (project_key, nom, categorie, ordre)
select 'notelia', v.nom, v.categorie, v.ordre
from (values ('En cours','potentiel',1),('Validé','realise',2),('Perdu','perdu',3)) as v(nom,categorie,ordre)
where not exists (select 1 from public.app_statuts s where s.project_key='notelia' and s.nom=v.nom);

-- ---------- 6) Accès admin pour David ----------
insert into public.app_memberships (user_id, project_key, role)
select u.id, 'notelia', 'admin'
from auth.users u
where u.email = 'davidbouaziz89@gmail.com'
  and not exists (
    select 1 from public.app_memberships m
    where m.user_id = u.id and m.project_key = 'notelia'
  );

-- Fin. Après exécution : ouvre notelia.html, connecte-toi, la tuile Notelia apparaît.
