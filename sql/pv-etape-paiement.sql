-- CRM Photovoltaïque — Étape « Paiement » (dernière étape avant Terminé)
-- Rôle dédié « paiement » : statut (configurable) + commentaire.
alter table public.pv_leads
  add column if not exists paiement_statut     text,
  add column if not exists paiement_commentaire text;

-- Statuts de paiement configurables (Paramètres). Si vide -> 4 par défaut.
create table if not exists public.pv_paiement_statuts (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  couleur    text,
  ordre      int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.pv_paiement_statuts enable row level security;

drop policy if exists pv_pai_statuts_read on public.pv_paiement_statuts;
create policy pv_pai_statuts_read on public.pv_paiement_statuts
  for select to authenticated using (has_pv_access());

drop policy if exists pv_pai_statuts_write on public.pv_paiement_statuts;
create policy pv_pai_statuts_write on public.pv_paiement_statuts
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on public.pv_paiement_statuts to authenticated;

insert into public.pv_paiement_statuts (nom, couleur, ordre)
select v.nom, v.couleur, v.ordre from (values
  ('EN ATTENTE','#f59e0b',1),('PAYÉ','#16a34a',2),
  ('PROBLÈME','#dc2626',3),('FINANCEMENT FINALISÉ','#38bdf8',4)
) as v(nom,couleur,ordre)
where not exists (select 1 from public.pv_paiement_statuts);
