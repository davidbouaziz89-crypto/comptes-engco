-- Marketing IA — autoriser l'app à déposer des images dans le bucket `mkt-images`
-- (logos de société envoyés depuis le navigateur, visuels finalisés avec le logo incrusté).
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

-- L'accroche incrustée sur le visuel (écrite par le Directeur artistique)
alter table public.mkt_posts add column if not exists image_headline text;

drop policy if exists mkt_images_auth_write on storage.objects;
create policy mkt_images_auth_write on storage.objects
  for insert to authenticated with check (bucket_id = 'mkt-images');

drop policy if exists mkt_images_auth_update on storage.objects;
create policy mkt_images_auth_update on storage.objects
  for update to authenticated using (bucket_id = 'mkt-images') with check (bucket_id = 'mkt-images');
