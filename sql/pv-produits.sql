-- CRM Photovoltaïque — catalogue produits (3 catégories : PV, Pack, Split) avec prix HT
create table if not exists public.pv_produits (
  id         uuid primary key default gen_random_uuid(),
  categorie  text not null,            -- 'pv' | 'pack' | 'split'
  nom        text not null,
  prix_ht    numeric,
  ordre      int  not null default 0,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.pv_produits enable row level security;

drop policy if exists pv_produits_read on public.pv_produits;
create policy pv_produits_read on public.pv_produits
  for select to authenticated using (has_pv_access());

drop policy if exists pv_produits_write on public.pv_produits;
create policy pv_produits_write on public.pv_produits
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on public.pv_produits to authenticated;
