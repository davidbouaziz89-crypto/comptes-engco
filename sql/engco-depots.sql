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
