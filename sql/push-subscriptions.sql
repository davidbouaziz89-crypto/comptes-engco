-- Notifications push : abonnements des appareils (un par navigateur/téléphone)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

-- Chaque utilisateur gère uniquement ses propres abonnements
drop policy if exists push_sub_select on public.push_subscriptions;
create policy push_sub_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_sub_insert on public.push_subscriptions;
create policy push_sub_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists push_sub_update on public.push_subscriptions;
create policy push_sub_update on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_sub_delete on public.push_subscriptions;
create policy push_sub_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;
