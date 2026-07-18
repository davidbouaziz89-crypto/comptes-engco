-- CRM Photovoltaïque — Frais / dépenses (globaux + rattachables à un client)
-- Visibilité et gestion réservées à l'admin (is_super_admin).

-- Catégories de frais (liste gérable dans Paramètres, comme sources / types)
create table if not exists public.pv_frais_cats (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  ordre      int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.pv_frais_cats enable row level security;

drop policy if exists pv_frais_cats_read on public.pv_frais_cats;
create policy pv_frais_cats_read on public.pv_frais_cats
  for select to authenticated using (is_super_admin());

drop policy if exists pv_frais_cats_write on public.pv_frais_cats;
create policy pv_frais_cats_write on public.pv_frais_cats
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on public.pv_frais_cats to authenticated;

-- Frais
create table if not exists public.pv_frais (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default now(),
  categorie   text,
  libelle     text,
  fournisseur text,
  montant     numeric,
  lead_id     uuid references public.pv_leads(id) on delete set null,  -- client optionnel
  created_by  uuid,
  created_at  timestamptz not null default now()
);
alter table public.pv_frais enable row level security;

drop policy if exists pv_frais_read on public.pv_frais;
create policy pv_frais_read on public.pv_frais
  for select to authenticated using (is_super_admin());

drop policy if exists pv_frais_write on public.pv_frais;
create policy pv_frais_write on public.pv_frais
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on public.pv_frais to authenticated;

-- Quelques catégories de départ (ignorées si déjà présentes)
insert into public.pv_frais_cats (nom, ordre)
select v.nom, v.ordre from (values
  ('Achat de leads',1),('Carburant / déplacement',2),('Publicité',3),
  ('Sous-traitance',4),('Matériel',5),('Frais bancaires',6),('Autre',9)
) as v(nom,ordre)
where not exists (select 1 from public.pv_frais_cats);
