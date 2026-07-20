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
