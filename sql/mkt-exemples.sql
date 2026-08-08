-- Marketing IA — posts de référence par société.
--
-- Aucun brief, aussi détaillé soit-il, ne vaut deux ou trois posts que David a
-- validés lui-même : l'IA imite un exemple bien mieux qu'elle ne suit une consigne.
-- C'est ce qui manquait — les textes générés partaient dans un style littéraire
-- alors que ses posts publiés sont structurés, avec listes, emoji et appel à l'action.
--
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

alter table public.mkt_editorial add column if not exists exemples text;

comment on column public.mkt_editorial.exemples is
  'Posts déjà publiés et validés par David, servant de modèles de style à l''IA.';
