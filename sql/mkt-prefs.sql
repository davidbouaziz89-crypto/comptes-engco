-- Marketing IA — préférences (quota d'images gratuites Google).
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

create table if not exists public.mkt_prefs (
  owner uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  free_images_per_day integer not null default 100,   -- quota gratuit Google, ajustable dans l'app
  updated_at timestamptz not null default now()
);

alter table public.mkt_prefs enable row level security;

drop policy if exists mkt_prefs_all on public.mkt_prefs;
create policy mkt_prefs_all on public.mkt_prefs for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

grant select, insert, update on public.mkt_prefs to authenticated;
