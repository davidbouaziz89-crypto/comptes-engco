# RÉCAP — Import des applis dans le portail (CRM Formation + Pointage)

> Pour reprendre sur un autre ordinateur : cloner ce dépôt, puis dire à Claude
> « lis RECAP-IMPORT.md et continue ». La mémoire de Claude ne suit pas d'un PC à l'autre — ce fichier fait office de passation.

Dernière mise à jour : 2026-07-14.

## Le portail
- **Site en ligne** : https://gestion.proformationplus.fr (sous-domaine IONOS → GitHub Pages)
- **Dépôt** : `davidbouaziz89-crypto/comptes-engco` (public, branche `main`), CNAME=gestion.proformationplus.fr
- **Base de données unique** : Supabase projet **unified-backend**, réf `lrslisyydbiejqzpsoxc` (org ENGCO). Clé publishable dans le HTML : `sb_publishable_4mNr4f4_4yKGcJeBOLD1QQ_0CXSyuJP`
- **Fichiers / briques** (déclarées dans `index.html` → `EXTERNAL_TOOLS`) :
  - `index.html` = portail (login, comptes associés LED/Vélo, console admin utilisateurs/rôles). ⚠️ **aussi édité par une autre conversation Claude → toujours `git pull` avant d'éditer index.html.**
  - `documents.html` = 📄 Générateur de documents (brique `docucrm`)
  - `crm.html` = 🎓 CRM Formation (brique `crmformation`)
  - `pointage.html` = ⏱️ TimeGuard Pro / Pointage (brique `pointage`)
  - **Thème clair/sombre** (🌙/☀️) sur les 3 pages, préférence partagée (localStorage `pfp-theme`).

## Comment publier (sur n'importe quel PC)
Pas de serveur MCP ; on utilise **`gh` CLI** + git :
1. `gh auth status` (se connecter avec `gh auth login` si besoin, compte `davidbouaziz89-crypto`).
2. `gh repo clone davidbouaziz89-crypto/comptes-engco ~/comptes-engco`
3. Éditer les fichiers, `git pull` (surtout avant index.html), `git commit`, `git push`.
4. GitHub Pages se met à jour en ~1 min (Ctrl+F5).

## Accès Supabase (base unified-backend)
- Node.js absent → pas de MCP Supabase. On passe par l'**API Management** en curl :
  `POST https://api.supabase.com/v1/projects/lrslisyydbiejqzpsoxc/database/query` avec header
  `Authorization: Bearer <PERSONAL_ACCESS_TOKEN>` + **`User-Agent: curl/8.7.1`** (sinon Cloudflare 1010).
- **Jeton** : régénérer un Personal Access Token sur https://supabase.com/dashboard/account/tokens (compte ENGCO). L'ancien jeton de la session précédente peut être révoqué.
- Pour les uploads storage / créer des comptes auth : clé **service_role** via
  `GET https://api.supabase.com/v1/projects/lrslisyydbiejqzpsoxc/api-keys` (à régénérer côté Supabase après usage).

---

# 1) CRM FORMATION — ✅ TERMINÉ
- Page `crm.html`, brique `crmformation`. Reconstruit fidèlement depuis le code Lovable **`davidbouaziz89-crypto/crm-formation-francais`** (repo à cloner pour toute évolution — le vrai code fait foi).
- **Base** : tables `crm_*` dans le **schéma public** de unified-backend. Données migrées depuis l'ancien Supabase `backend-formation` (29 formations, 8 catégories, 4 organismes, 6 statuts).
- **Fonctionnel** : leads (liste, recherche, filtres, import Excel), pipeline kanban, **fiche lead** (infos prospect à gauche / parcours 5 étapes à droite : cartes budget Montant/Formations/Restant, ajout de plusieurs formations filtrées par budget avec prix mini = réduction max, liens EDOF/Calendly, dates), commentaires signés (suppr. admin), catalogue formations complet, paramètres (organismes/catégories/statuts).

# 2) POINTAGE — « TimeGuard Pro » — 🟡 EN COURS (P1→P4 faits, reste P4 fin + P5)
- Page `pointage.html`, brique `pointage`. Reconstruit depuis le code Lovable **`davidbouaziz89-crypto/work-flow-zone`** (**Lovable Cloud** — base gérée par Lovable, réf source `ctzdhbokovvahdqpjwee`, PAS dans le compte Supabase perso). Le vrai code (src/pages/*, src/components/admin/*, src/hooks/usePointage.tsx, src/lib/*) fait foi.
- **Base** : tout est dans un **schéma dédié `pointage`** de unified-backend (pour ne pas entrer en collision avec `profiles`/etc. du portail). Client JS : `sb.schema('pointage')`. Schéma exposé à l'API (PostgREST db_schema = `public, graphql_public, fillforge, pointage` — **préserver `fillforge`** d'une autre app en cas de PATCH).

### FAIT (migration à l'identique)
- **25 tables** recréées (structure exacte), **2411 lignes** de données chargées (17 employés, 1427 pointages, 262 commentaires, 173 jours d'école, 119 bulletins, 50 absences école, 32 demandes, etc.).
- **Sécurité** : 10 fonctions, 164 policies RLS, 23 triggers, RLS activée partout (rôles admin/manager/employee/comptable via `pointage.has_role`).
- **173 fichiers** (bulletins, documents, logos, 68 Mo) réhébergés dans 3 buckets storage (`employee-documents`, `payslips` privés ; `company-logos` public) + `file_url` réécrits vers unified-backend. Buckets privés → l'app lit via `createSignedUrl`.
- **17 comptes employés** créés (Auth admin API), mot de passe temporaire **`TimeGuard2026!`** (à faire changer). Les `user_id` de l'historique ont été remappés vers les nouveaux comptes (David admin = son compte portail `1ca2adf1-cdb6-4727-855c-d8f3aef8d58d`). Employés se connectent sur `/pointage.html` (pas via le portail).

### FAIT (interface)
- **Admin** : Tableau de bord, Employés (+fiche détail), Pointages (jour/mois, filtre, **export Excel**), 📨 Demandes (approuver/refuser + messagerie), Documents & Bulletins (**+ upload**), Zones GPS, Paramètres.
- **Employé** : « Mon pointage » (pointer entrée/sortie + pauses + **contrôle GPS zones 50 m** + chrono), « Mes heures » du mois, « Mes demandes » (congés/absences).

### RESTE À FAIRE
- **Primes** (`employee_bonus`) & **ajustements mensuels** (`employee_monthly_adjustments`) : vue/édition.
- **CRUD admin** : créer/éditer un employé (horaires, équipe, taux, zones GPS), éditer `zones_gps`/`equipes`/catégories/`public_holidays` (actuellement lecture seule).
- **Plannings hebdo** (`employees.horaires_hebdomadaires`) + **jours d'école** (`employee_school_days`) + **absences école** (`employee_school_absences`).
- **Exports PDF** mensuels (voir `src/lib/pdfExport.ts`, `monthlyDetailExport.ts`, `teamExport.ts`).
- **Fonctions serveur** (edge functions à porter/déployer sur unified-backend) : dépointage automatique de fin de journée (`auto-clock-out`), emails (Resend — envoi horaires mensuels `send-pointage-email`), « mot de passe oublié » employé, création de compte employé (`create-employee`).

### Notes techniques utiles
- Données source ré-exportables si besoin via le SQL editor de Lovable Cloud (Cloud → SQL editor → Export CSV) : `select json_build_object('table', (select json_agg(t) from table t), …)::text`.
- Logique pointage (dans `usePointage.tsx`) : clock-in insert `pointages` (status `in_progress`, heure_debut, GPS, ip) ; clock-out update heure_fin+`completed` (triggers calculent `temps_total`/`temps_net`) ; pauses insert/update `pause_fin` (trigger calcule `duree`). GPS : zones actives de l'employé, Haversine, OK si distance ≤ rayon_m + 50.
