-- Marketing IA — suppression des tables du CRM prospects.
-- Le CRM a été retiré de l'app (il relevait d'un autre projet) : ce script efface
-- ce qu'il avait créé. À ne lancer QUE si tu ne comptes pas y revenir :
-- l'opération est irréversible et supprime les données éventuellement saisies.

alter table if exists public.mkt_ads drop column if exists pipeline_id;

drop table if exists public.mkt_lead_events cascade;
drop table if exists public.mkt_leads cascade;
drop table if exists public.mkt_lead_fields cascade;
drop table if exists public.mkt_stages cascade;
drop table if exists public.mkt_pipelines cascade;
