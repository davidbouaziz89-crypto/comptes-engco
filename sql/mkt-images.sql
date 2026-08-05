-- Marketing IA — visuels des posts (agent Directeur artistique).
-- Ajoute l'image sur chaque post + le bucket de stockage public.
-- Idempotent : peut être relancé sans risque. À lancer dans l'éditeur SQL Supabase.

-- 1) Colonnes image sur les posts
alter table public.mkt_posts add column if not exists image_url text;
alter table public.mkt_posts add column if not exists image_prompt text;   -- la consigne envoyée au générateur
alter table public.mkt_posts add column if not exists image_style text;    -- style choisi par l'IA
alter table public.mkt_posts add column if not exists image_alt text;      -- description (accessibilité)
alter table public.mkt_posts add column if not exists image_error text;
alter table public.mkt_posts add column if not exists image_status text not null default 'none';

do $$ begin
  alter table public.mkt_posts
    add constraint mkt_posts_image_status_chk
    check (image_status in ('none','pending','ready','error'));
exception when duplicate_object then null; end $$;

-- 2) Couleurs de marque (utilisées par le Directeur artistique pour rester cohérent)
alter table public.mkt_editorial add column if not exists brand_colors text;

-- 3) Bucket public pour les visuels générés
insert into storage.buckets (id, name, public)
values ('mkt-images', 'mkt-images', true)
on conflict (id) do update set public = true;

-- Lecture publique des visuels (le bucket est public ; cette policy rend l'accès explicite)
drop policy if exists mkt_images_public_read on storage.objects;
create policy mkt_images_public_read on storage.objects
  for select to public using (bucket_id = 'mkt-images');
