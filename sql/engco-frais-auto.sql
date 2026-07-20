-- Compta : marque un frais généré automatiquement (récurrent) vs saisi à la main
alter table public.engco_frais add column if not exists auto boolean not null default false;
alter table public.velo_frais  add column if not exists auto boolean not null default false;
