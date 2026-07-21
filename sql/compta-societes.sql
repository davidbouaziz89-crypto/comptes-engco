-- =====================================================================
-- Pré-création des 6 sociétés de David (avec logo + couleur de marque).
-- Régime TVA par défaut = réel mensuel / 20 % (ajustable ensuite dans l'app).
-- Idempotent : ne recrée pas une société déjà présente (même nom).
-- =====================================================================
insert into compta_companies (name, logo_key, color, vat_regime, default_vat_rate)
select v.name, v.logo_key, v.color, 'reel_mensuel', 20.00
from (values
  ('Notelia',                'notelia',         '#12305b'),
  ('DB Communication L.T.D', 'db-communication','#4a4a4a'),
  ('DB Telecom',             'db-telecom',      '#1877b5'),
  ('MB Formation',           'mb-formation',    '#1a1aff'),
  ('Vos Formateurs',         'vos-formateurs',  '#0f1b3d'),
  ('ENGCO',                  'engco',           '#3aa54a')
) as v(name, logo_key, color)
where not exists (select 1 from compta_companies c where c.name = v.name);
