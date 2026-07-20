-- Volume CEE (kWh cumac) sur le dossier LED
alter table public.engco_dossiers add column if not exists cumac numeric;
