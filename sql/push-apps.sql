-- Portail — abonnements push séparés par application.
--
-- Un navigateur n'a qu'UN abonnement push (le service worker est à la racine du
-- domaine, donc partagé par toutes les apps du portail). On ne peut donc pas
-- séparer au niveau de l'abonnement : on note à côté, app par app, celles dont
-- l'utilisateur veut recevoir les notifications. Chaque expéditeur filtre dessus.
--
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

create table if not exists public.push_app_optins (
  endpoint text not null,
  app text not null,                 -- 'marketing' | 'pointage' | 'photovoltaique' | …
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (endpoint, app)
);

create index if not exists push_app_optins_user_idx on public.push_app_optins(user_id, app);

alter table public.push_app_optins enable row level security;

drop policy if exists push_app_optins_own on public.push_app_optins;
create policy push_app_optins_own on public.push_app_optins for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_app_optins to authenticated;

-- Reprise de l'existant : les appareils déjà abonnés avant cette séparation
-- reçoivent tout, comme avant. Sans cette ligne, ils cesseraient d'un coup de
-- recevoir quoi que ce soit — une régression silencieuse.
insert into public.push_app_optins (endpoint, app, user_id)
select s.endpoint, a.app, s.user_id
from public.push_subscriptions s
cross join (values ('marketing'), ('pointage'), ('photovoltaique')) as a(app)
on conflict do nothing;
