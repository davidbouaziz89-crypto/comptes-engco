-- Marketing IA — ce que l'équipe sait de la société, et ce qu'elle réclame.
-- Les agents posent une question quand une information leur manque ; David répond
-- dans l'onglet Paramétrage, et la réponse rejoint le contexte de tous les agents.
-- Idempotent. À lancer dans l'éditeur SQL Supabase, projet unified-backend.

create table if not exists public.mkt_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.mkt_companies(id) on delete cascade,
  question text not null,             -- ce que l'équipe veut savoir
  answer text,                        -- la réponse de David (null = en attente)
  asked_by text,                      -- clé de l'agent qui a posé la question
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists mkt_facts_company_idx on public.mkt_facts(company_id, created_at desc);

alter table public.mkt_facts enable row level security;

drop policy if exists mkt_facts_all on public.mkt_facts;
create policy mkt_facts_all on public.mkt_facts for all to authenticated
  using (public.mkt_owns(company_id)) with check (public.mkt_owns(company_id));

grant select, insert, update, delete on public.mkt_facts to authenticated;
