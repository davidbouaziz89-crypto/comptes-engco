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
