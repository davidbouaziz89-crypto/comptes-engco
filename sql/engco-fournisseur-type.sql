-- Type du fournisseur : dépense ou récurrent (le choix récurrent/dépense passe au niveau du fournisseur)
alter table public.engco_fournisseurs add column if not exists type text not null default 'depense';
