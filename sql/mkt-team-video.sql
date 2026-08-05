-- Marketing IA — avatars en vidéo (Veo).
-- Chaque collègue a une courte vidéo qui tourne en boucle à la place des images.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

alter table public.mkt_team add column if not exists avatar_video_url text;
alter table public.mkt_team add column if not exists video_op text;   -- opération Veo en cours
