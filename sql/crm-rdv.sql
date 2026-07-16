-- ============================================================================
--  CRM FORMATION — Agenda / calendrier des RDV de rappel
--  Base unifiée (unified-backend, projet lrslisyydbiejqzpsoxc)
--  Sécurité : ADMIN voit / gère TOUS les RDV ; chaque commercial ne voit
--             et ne gère QUE les siens (owner_id = auth.uid()).
--  À exécuter dans Supabase → SQL Editor → Run.
-- ============================================================================

create table if not exists public.crm_rdv(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid references public.crm_leads(id) on delete set null,
  owner_id uuid not null default auth.uid(),      -- le commercial qui pose le RDV
  owner_email text,                               -- pour l'affichage côté admin
  titre text not null default 'Rappel',
  date_rdv date not null,
  heure time,
  type text not null default 'rappel',
  notes text,
  done boolean not null default false
);
create index if not exists crm_rdv_date_idx  on public.crm_rdv(date_rdv);
create index if not exists crm_rdv_owner_idx on public.crm_rdv(owner_id);

alter table public.crm_rdv enable row level security;

drop policy if exists crm_rdv_sel on public.crm_rdv;
drop policy if exists crm_rdv_ins on public.crm_rdv;
drop policy if exists crm_rdv_upd on public.crm_rdv;
drop policy if exists crm_rdv_del on public.crm_rdv;

-- Lecture : admin = tout ; commercial = ses propres RDV
create policy crm_rdv_sel on public.crm_rdv for select
  using (public.has_crm_access() and (public.is_crm_admin() or owner_id = auth.uid()));

-- Création : réservé à son propre compte
create policy crm_rdv_ins on public.crm_rdv for insert
  with check (public.has_crm_access() and owner_id = auth.uid());

-- Modification : admin ou propriétaire
create policy crm_rdv_upd on public.crm_rdv for update
  using (public.is_crm_admin() or owner_id = auth.uid())
  with check (public.is_crm_admin() or owner_id = auth.uid());

-- Suppression : admin ou propriétaire
create policy crm_rdv_del on public.crm_rdv for delete
  using (public.is_crm_admin() or owner_id = auth.uid());
