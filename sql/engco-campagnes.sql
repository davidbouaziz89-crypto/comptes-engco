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
