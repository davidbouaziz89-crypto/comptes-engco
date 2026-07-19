-- CRM Photovoltaïque — Statuts du financement configurables
-- Liste gérable dans Paramètres. Le drapeau "perd" bascule le dossier en Perdu.
-- Si la table est vide, l'appli utilise 3 statuts par défaut (dont REFUSÉ -> Perdu).
create table if not exists public.pv_financement_statuts (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  couleur    text,
  perd       boolean not null default false,   -- true = passe automatiquement le dossier en Perdu
  ordre      int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.pv_financement_statuts enable row level security;

drop policy if exists pv_fin_statuts_read on public.pv_financement_statuts;
create policy pv_fin_statuts_read on public.pv_financement_statuts
  for select to authenticated using (has_pv_access());

drop policy if exists pv_fin_statuts_write on public.pv_financement_statuts;
create policy pv_fin_statuts_write on public.pv_financement_statuts
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

grant select, insert, update, delete on public.pv_financement_statuts to authenticated;

-- Préremplissage des 3 statuts par défaut (ignoré si déjà présents)
insert into public.pv_financement_statuts (nom, couleur, perd, ordre)
select v.nom, v.couleur, v.perd, v.ordre from (values
  ('ACCEPTÉ','#16a34a',false,1),
  ('REFUSÉ','#dc2626',true,2),
  ('EN ATTENTE','#f59e0b',false,3)
) as v(nom,couleur,perd,ordre)
where not exists (select 1 from public.pv_financement_statuts);
