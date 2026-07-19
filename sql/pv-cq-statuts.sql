-- CRM Photovoltaïque — Statuts du contrôle qualité configurables
-- Liste gérable dans Paramètres. Si vide, l'appli utilise 4 statuts par défaut.
create table if not exists public.pv_cq_statuts (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  couleur    text,
  ordre      int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.pv_cq_statuts enable row level security;

drop policy if exists pv_cq_statuts_read on public.pv_cq_statuts;
create policy pv_cq_statuts_read on public.pv_cq_statuts
  for select to authenticated using (has_pv_access());

drop policy if exists pv_cq_statuts_write on public.pv_cq_statuts;
create policy pv_cq_statuts_write on public.pv_cq_statuts
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on public.pv_cq_statuts to authenticated;

-- Optionnel : préremplir avec les 4 statuts par défaut (ignoré si déjà présents)
insert into public.pv_cq_statuts (nom, couleur, ordre)
select v.nom, v.couleur, v.ordre from (values
  ('CQ OK','#16a34a',1),('À travailler','#f59e0b',2),
  ('MORT','#dc2626',3),('Dossier envoyé','#38bdf8',4)
) as v(nom,couleur,ordre)
where not exists (select 1 from public.pv_cq_statuts);
