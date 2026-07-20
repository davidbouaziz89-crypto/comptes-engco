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
