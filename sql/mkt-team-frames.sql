-- Marketing IA — poses d'animation des avatars.
-- Chaque collègue a 3 images : au repos + 2 poses de travail qui s'alternent.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

alter table public.mkt_team add column if not exists avatar_work1_url text;
alter table public.mkt_team add column if not exists avatar_work2_url text;
