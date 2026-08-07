-- Marketing IA — CRM des prospects issus des campagnes.
--
-- Contrairement au CRM Photovoltaïque, dont les étapes sont figées dans le code,
-- ici tout est configurable : un pipeline par type de campagne, avec ses propres
-- étapes ET ses propres champs à remplir. Une campagne « standard téléphonique »
-- ne demande pas les mêmes informations qu'une campagne « photovoltaïque ».
--
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

-- 1) Le pipeline : un parcours nommé, rattaché à une société.
create table if not exists public.mkt_pipelines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.mkt_companies(id) on delete cascade,
  nom text not null,
  defaut boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) Ses étapes, ordonnées.
create table if not exists public.mkt_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.mkt_pipelines(id) on delete cascade,
  cle text not null,
  libelle text not null,
  couleur text not null default '#7c5cff',
  ordre integer not null default 0,
  gagne boolean not null default false,      -- étape de succès
  perdu boolean not null default false,      -- étape d'abandon
  unique (pipeline_id, cle)
);

-- 3) Les champs à remplir, propres au pipeline.
-- Les coordonnées de base (nom, téléphone, mail, adresse) sont dans mkt_leads :
-- elles servent à tous. Ici on ajoute ce qui dépend du métier.
create table if not exists public.mkt_lead_fields (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.mkt_pipelines(id) on delete cascade,
  cle text not null,
  libelle text not null,
  type text not null default 'texte'
    check (type in ('texte','zone','tel','email','nombre','date','liste','case')),
  options text,                              -- valeurs séparées par des ; pour le type liste
  requis boolean not null default false,
  ordre integer not null default 0,
  unique (pipeline_id, cle)
);

-- 4) Les prospects.
create table if not exists public.mkt_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.mkt_companies(id) on delete cascade,
  pipeline_id uuid references public.mkt_pipelines(id) on delete set null,
  ad_id uuid references public.mkt_ads(id) on delete set null,     -- la campagne d'origine
  stage text,                                -- clé d'étape dans le pipeline
  nom text,
  prenom text,
  tel text,
  email text,
  adresse text,
  code_postal text,
  ville text,
  source text default 'manuel',              -- manuel | facebook | instagram | linkedin | import
  external_id text,                          -- identifiant du lead chez Meta, pour ne pas l'importer deux fois
  notes text,
  extra jsonb not null default '{}'::jsonb,  -- les champs propres au pipeline
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mkt_leads_co_idx on public.mkt_leads(company_id, created_at desc);
create index if not exists mkt_leads_stage_idx on public.mkt_leads(pipeline_id, stage);
create unique index if not exists mkt_leads_ext_idx
  on public.mkt_leads(company_id, external_id) where external_id is not null;

-- 5) L'historique des passages d'étape : c'est ce qui permettra de mesurer
-- où les prospects se perdent.
create table if not exists public.mkt_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.mkt_leads(id) on delete cascade,
  de text,
  vers text,
  commentaire text,
  created_at timestamptz not null default now()
);

-- 6) Chaque campagne peut suivre son propre pipeline.
alter table public.mkt_ads add column if not exists pipeline_id uuid references public.mkt_pipelines(id) on delete set null;

-- ---------- Sécurité : tout passe par la propriété de la société ----------
alter table public.mkt_pipelines enable row level security;
alter table public.mkt_stages enable row level security;
alter table public.mkt_lead_fields enable row level security;
alter table public.mkt_leads enable row level security;
alter table public.mkt_lead_events enable row level security;

drop policy if exists mkt_pipelines_manage on public.mkt_pipelines;
create policy mkt_pipelines_manage on public.mkt_pipelines for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

drop policy if exists mkt_stages_manage on public.mkt_stages;
create policy mkt_stages_manage on public.mkt_stages for all to authenticated
  using (exists (select 1 from public.mkt_pipelines p
                 where p.id = mkt_stages.pipeline_id and public.mkt_owns(p.company_id)))
  with check (exists (select 1 from public.mkt_pipelines p
                 where p.id = mkt_stages.pipeline_id and public.mkt_owns(p.company_id)));

drop policy if exists mkt_lead_fields_manage on public.mkt_lead_fields;
create policy mkt_lead_fields_manage on public.mkt_lead_fields for all to authenticated
  using (exists (select 1 from public.mkt_pipelines p
                 where p.id = mkt_lead_fields.pipeline_id and public.mkt_owns(p.company_id)))
  with check (exists (select 1 from public.mkt_pipelines p
                 where p.id = mkt_lead_fields.pipeline_id and public.mkt_owns(p.company_id)));

drop policy if exists mkt_leads_manage on public.mkt_leads;
create policy mkt_leads_manage on public.mkt_leads for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

drop policy if exists mkt_lead_events_manage on public.mkt_lead_events;
create policy mkt_lead_events_manage on public.mkt_lead_events for all to authenticated
  using (exists (select 1 from public.mkt_leads l
                 where l.id = mkt_lead_events.lead_id and public.mkt_owns(l.company_id)))
  with check (exists (select 1 from public.mkt_leads l
                 where l.id = mkt_lead_events.lead_id and public.mkt_owns(l.company_id)));

grant select, insert, update, delete on public.mkt_pipelines to authenticated;
grant select, insert, update, delete on public.mkt_stages to authenticated;
grant select, insert, update, delete on public.mkt_lead_fields to authenticated;
grant select, insert, update, delete on public.mkt_leads to authenticated;
grant select, insert, update, delete on public.mkt_lead_events to authenticated;
