# Comptes ENGCO — Récapitulatif du projet

> Application web sur mesure pour gérer les comptes entre associés (dossiers, marges,
> investissements, rentabilité) sur deux activités : **LED intérieure** et **Vélo**.
>
> ⚠️ Ce dépôt est **public** : ce fichier ne contient **aucun mot de passe ni token**.
> Les identifiants de connexion se trouvent dans le récapitulatif privé (page Claude/artifact).

## Accès

- **Appli en ligne** : https://davidbouaziz89-crypto.github.io/comptes-engco/
- **Dépôt** : `davidbouaziz89-crypto/comptes-engco`, branche `main`
- **Fichier de l'appli** : `index.html` — un seul fichier, tout est dedans (HTML + JavaScript).

## Comment ça marche (technique)

- **Front** : `index.html` autonome. Librairies via CDN : `@supabase/supabase-js` et `xlsx` (SheetJS).
- **Base de données** : Supabase (Postgres). Projet `lrslisyydbiejqzpsoxc`.
  Tables préfixées `engco_` (LED) et `velo_` (vélo). Table d'accès `app_memberships`, régies `app_regies`.
- **Auth** : Supabase Auth (email/mot de passe). Rôles : `admin`, `secretaire`, `regie` (lecture seule).
- **Hébergement** : GitHub Pages (branche `main`, racine). Toute mise à jour de `index.html`
  poussée sur `main` met le site à jour automatiquement (~1 min).
- **Lien CRM** : `nrj.koneckt.fr/crm/contact.php?id_contact={id}` (config `CRM_URL_TEMPLATE` en haut du script).
- **API SIRET** (remplissage auto vélo) : `recherche-entreprises.api.gouv.fr` (gratuite, CORS ouvert).

## Les deux projets

Sélection du projet à la connexion. Config dans l'objet `PROJECTS` du script.

- **LED** (`engco_`) — 2 associés JD (David) / Dan. Commission régie en **pourcentage** de la marge.
- **Vélo** (`velo_`) — 4 associés David / Dan / Kevin / Simon (parts égales).
  Chiffre = nb vélos × tarif région (**France 80 / Corse 390 / DOM-TOM 390**, éditable).
  Commission régie = **montant en € par vélo**, différent par région.

## Règles métier (validées avec David)

- **Cascade marge** : marge brute − part manager (% « David », un tiers) − commission régie = **marge nette**,
  partagée à parts égales entre associés. Colonnes calculées (generated) côté Postgres.
- **Campagne interne** (`regie_interne`) : la commission est calculée et affichée mais **ne réduit pas**
  la marge nette (elle « reste dans la boîte »). Régies vélo internes actuelles : J2D, MARSEILLE, MADA (80/380/380).
- **Statut dossier** : `En cours` / `Validé` / `Perdu`. Les KPI « Résultat société » et « à se partager »
  du tableau de bord sont basés sur les dossiers **Validé** uniquement. Import → tout arrive en `En cours`.
- **Frais payé par une société** = compté comme **apport** (investissement) de l'associé (règle du loyer).
- **Shekel** : conversion ILS→€ **majorée de 15 %** (frais de change), dans les colonnes generated des apports.
- **Investissements partagés** : un investissement d'un associé est réparti ÷ nb associés ; les autres lui doivent leur part.

## Principales fonctionnalités

- Dossiers : statut, ID CRM cliquable, coordonnées (adresse/CP/ville/tél/email), remplissage auto par SIRET (vélo),
  alerte doublon (même ID CRM ou n° dépôt), recherche + filtres (régie / région / statut).
- Tableau de bord : rentabilité par statut (CA + marge : potentiel / validé / perdu), à se partager, investissements,
  bénéfice à partager, récupérations d'argent. Réorganisé en sections claires.
- Régies/campagnes configurables (`app_regies`) ; suivi des commissions gagnées par régie.
- Apports, sources (répartition par associé), frais/dépenses, frais récurrents (alerte mois manquant).
- Import/export Excel (dossiers, apports, frais) avec **anti-doublons** ; import vélo auto-remplit la commission depuis la config régie.
- Utilisateurs & rôles (écran admin), barre d'onglets collante.

## Publier une modification

L'appli locale de David est éditée puis `index.html` est poussé sur `main`. Deux méthodes :

1. **git** classique : `git add index.html && git commit && git push` (depuis un clone du dépôt).
2. **API GitHub** (utilisée jusqu'ici depuis le poste sans clone) : `PUT /repos/:owner/:repo/contents/index.html`
   avec le contenu en base64 + le `sha` courant. Message de commit en **ASCII** et corps envoyé en **UTF-8**
   (sinon GitHub renvoie 400).

Après push, GitHub Pages publie automatiquement.

## Migrations de base

Faites via l'outil Supabase (MCP) ou l'éditeur SQL Supabase. Historique des colonnes ajoutées :
`crm_id`, `statut`, `adresse`, `code_postal`, `ville`, `telephone`, `email` sur les tables dossiers ;
`montant_france/corse/domtom` + `interne` sur `app_regies` ; `regie_montant_unitaire` + `regie_interne`
sur `velo_dossiers` (colonnes generated `commission_regie` et `marge_nette` recréées en conséquence).

---
*Récapitulatif au 9 juillet 2026.*
