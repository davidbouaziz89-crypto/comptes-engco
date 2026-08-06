-- Marketing IA — suivi de la publication.
-- Tant que la publication automatique n'est pas branchée, on trace au moins
-- quand un post est réellement parti.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

alter table public.mkt_posts add column if not exists published_at timestamptz;
