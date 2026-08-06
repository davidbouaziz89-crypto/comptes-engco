-- Marketing IA — garder l'historique des discussions par post.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

alter table public.mkt_chats add column if not exists post_id uuid references public.mkt_posts(id) on delete cascade;
create index if not exists mkt_chats_post_idx on public.mkt_chats(post_id);
