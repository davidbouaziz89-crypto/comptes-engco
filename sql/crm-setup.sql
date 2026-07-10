-- ============================================================================
--  CRM FORMATION — Création des tables sur la base UNIFIÉE (unified-backend)
--  Projet Supabase : lrslisyydbiejqzpsoxc
--  À coller dans : Supabase > SQL Editor > New query > Run
--  Sans danger : si Supabase affiche "Potential issue detected", cliquer Run.
--  Ce script est ré-exécutable (IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================================

-- 1) CATALOGUE DES FORMATIONS -------------------------------------------------
create table if not exists public.crm_formations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  nom              text not null,
  tarif            numeric,
  heures_elearning numeric,
  heures_visio     numeric,
  description      text,
  actif            boolean not null default true
);

-- 2) LEADS --------------------------------------------------------------------
create table if not exists public.crm_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  name          text not null,                         -- nom du contact
  company       text,                                  -- société
  email         text,
  phone         text,
  stage         text not null default 'nouveau',       -- nouveau/contacte/qualifie/devis_envoye/gagne/perdu
  formation_id  uuid references public.crm_formations(id) on delete set null,
  montant       numeric,                               -- montant du devis / valeur
  disponibilite text,
  source        text,                                  -- ex : CALL IA, manuel, import
  notes         text,
  invoiced      boolean not null default false,        -- déjà facturé ?
  assigned_to   uuid,                                  -- commercial responsable (user_id)
  project_id    uuid                                   -- lien futur vers l'appli projets
);
create index if not exists crm_leads_stage_idx on public.crm_leads(stage);
create index if not exists crm_leads_created_idx on public.crm_leads(created_at desc);

-- 3) ACTIVITÉS / NOTES par lead ----------------------------------------------
create table if not exists public.crm_activities (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  lead_id     uuid references public.crm_leads(id) on delete cascade,
  user_id     uuid default auth.uid(),
  user_email  text,
  type        text,                                    -- note/appel/email/rdv
  content     text
);
create index if not exists crm_activities_lead_idx on public.crm_activities(lead_id, created_at desc);

-- ============================================================================
--  SÉCURITÉ (RLS) — même logique que le Générateur de documents :
--   • lecture/écriture : utilisateurs connectés ayant l'accès "crmformation"
--     (une ligne dans app_memberships) OU rôle admin
--   • suppression : réservée à l'admin
-- ============================================================================

-- Fonctions utilitaires (SECURITY DEFINER = contournent le RLS de app_memberships)
create or replace function public.has_crm_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_memberships m
    where m.user_id = auth.uid()
      and (m.project_key = 'crmformation' or m.role = 'admin')
  );
$$;

create or replace function public.is_crm_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_memberships m
    where m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

-- Activer RLS
alter table public.crm_formations enable row level security;
alter table public.crm_leads      enable row level security;
alter table public.crm_activities enable row level security;

-- On (re)crée les politiques proprement
do $$
declare t text;
begin
  foreach t in array array['crm_formations','crm_leads','crm_activities'] loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);

    execute format('create policy %I on public.%I for select using (public.has_crm_access())', t||'_sel', t);
    execute format('create policy %I on public.%I for insert with check (public.has_crm_access())', t||'_ins', t);
    execute format('create policy %I on public.%I for update using (public.has_crm_access()) with check (public.has_crm_access())', t||'_upd', t);
    execute format('create policy %I on public.%I for delete using (public.is_crm_admin())', t||'_del', t);
  end loop;
end $$;

-- ============================================================================
--  FIN. Après exécution, donnez-vous l'accès depuis le portail :
--  index.html > écran Utilisateurs > cochez "🎓 CRM Formation" pour votre compte
--  (l'admin a déjà accès à tout automatiquement).
-- ============================================================================
