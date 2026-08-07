-- Marketing IA — mise en page des visuels, choisie par société.
-- Chaque marque garde la même écriture graphique sur tous ses posts : c'est ce
-- qui distingue une communication tenue d'une suite d'images sans lien.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

alter table public.mkt_companies
  add column if not exists visual_layout text not null default 'scrim'
  check (visual_layout in ('scrim','bandeau','affiche','brut'));
