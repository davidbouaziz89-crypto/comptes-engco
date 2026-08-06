-- Marketing IA — pilote automatique.
-- Chaque lundi 6h, les agents écrivent la semaine des sociétés qui l'ont activé,
-- et David reçoit une notification « X posts prêts à valider ».
-- Un rappel part aussi chaque matin pour les posts du jour non validés.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

-- 1) Activation par société (désactivé par défaut : rien ne se déclenche sans ton accord)
alter table public.mkt_companies add column if not exists auto_weekly boolean not null default false;

-- 2) Planification. Le secret est repris de la tâche existante `zeste-push`,
--    pour ne pas avoir à le réécrire ici.
do $$
declare
  s text;
begin
  select (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'''))[1]
    into s from cron.job where jobname = 'zeste-push' limit 1;

  if s is null then
    raise exception 'Secret cron introuvable : vérifie la tâche zeste-push.';
  end if;

  perform cron.unschedule('mkt-weekly') where exists (select 1 from cron.job where jobname = 'mkt-weekly');
  perform cron.unschedule('mkt-daily')  where exists (select 1 from cron.job where jobname = 'mkt-daily');

  -- Lundi 6h00 (heure serveur) : écriture de la semaine + notification
  perform cron.schedule('mkt-weekly', '0 6 * * 1', format($f$
    select net.http_post(
      url := 'https://lrslisyydbiejqzpsoxc.supabase.co/functions/v1/mkt-cron',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','%s'),
      body := '{}'::jsonb
    );
  $f$, s));

  -- Tous les jours 8h00 : rappel des posts du jour non validés
  perform cron.schedule('mkt-daily', '0 8 * * *', format($f$
    select net.http_post(
      url := 'https://lrslisyydbiejqzpsoxc.supabase.co/functions/v1/mkt-cron',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','%s'),
      body := '{}'::jsonb
    );
  $f$, s));
end $$;

-- Vérification
select jobname, schedule from cron.job where jobname like 'mkt-%' order by jobname;
