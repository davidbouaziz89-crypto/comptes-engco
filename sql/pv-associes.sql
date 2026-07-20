-- CRM Photovoltaïque — Associés & répartition des bénéfices (admin uniquement)
create table if not exists public.pv_associes (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  part       numeric not null default 0,   -- part de l'associé (%), normalisée à l'affichage
  ordre      int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.pv_associes enable row level security;

drop policy if exists pv_associes_read on public.pv_associes;
create policy pv_associes_read on public.pv_associes
  for select to authenticated using (is_super_admin());

drop policy if exists pv_associes_write on public.pv_associes;
create policy pv_associes_write on public.pv_associes
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on public.pv_associes to authenticated;

-- Quel associé a payé le frais (investissement) — optionnel
alter table public.pv_frais
  add column if not exists paye_par uuid references public.pv_associes(id) on delete set null;
