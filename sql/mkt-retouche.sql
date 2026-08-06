-- Marketing IA — retouche d'image.
-- On garde le fond d'origine (avant incrustation du bandeau et du logo) :
-- c'est lui qu'on retouche quand David demande une modification ponctuelle.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

alter table public.mkt_posts add column if not exists image_raw_url text;
