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
