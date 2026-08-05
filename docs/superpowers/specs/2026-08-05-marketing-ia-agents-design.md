# Marketing IA — Plateforme d'agents pour le contenu & le développement commercial

**Date :** 2026-08-05
**Auteur :** David Bouaziz (vision) + Claude (architecture)
**Statut :** Design validé — prêt pour le plan d'implémentation
**Emplacement retenu :** nouvelle app intégrée au portail `comptes-engco` (`gestion.proformationplus.fr`)

---

## 1. Objectif

Construire un logiciel **multi-sociétés** piloté par des **agents IA** qui automatise le marketing de David :
génération de posts réseaux sociaux → validation en un clic (idéalement depuis le mobile) →
publication automatique sur le bon réseau à la bonne heure.

Le cœur du besoin (n°1) : pour une société, définir une cadence (ex. 3 posts/sem LinkedIn), laisser
les agents générer les posts selon une ligne éditoriale, recevoir une notif « post prêt, tu valides ? »,
répondre **Oui / Modifier / Non**, et si validé, laisser le logiciel publier seul.

## 2. Décisions validées (contexte du projet)

| Sujet | Décision |
|---|---|
| Stratégie de publication | **APIs officielles directes** (LinkedIn puis Meta), pas d'outil tiers type Buffer |
| Budget mensuel | 20–50 € / mois (Supabase + GitHub Pages gratuits ; clé Claude à l'usage) |
| Nombre de sociétés au départ | 2 à 3 |
| Cerveau IA | **Clé API Anthropic (Claude)**, modèle configurable |
| Emplacement | **Intégré** au portail existant `comptes-engco` (même login, même origine push) |
| Utilisateurs | **David seul** pour l'instant ; architecture prête pour plusieurs utilisateurs/rôles plus tard |
| Réseaux (ordre) | LinkedIn (prioritaire, B2B/leads) → Instagram + Facebook (Meta) |

## 3. Contraintes & principes non négociables

- **PWA responsive**, une seule base de code, utilisable et installable sur mobile (iPhone/Android).
- **Validation depuis le mobile** en un clic via **notifications push**.
- **Sécurité** : la clé Claude et les jetons réseaux (LinkedIn/Meta) ne sont **jamais** exposés au
  navigateur. Ils vivent côté serveur (secrets Supabase / table à accès service-role uniquement).
  Toute génération IA et toute publication passent par des **edge functions**.
- **Séparation stricte des données par société** (multi-tenant), appliquée via RLS Supabase.
- **Agents interchangeables** : le fournisseur/modèle IA est un paramètre, pas un choix figé dans le code.
- **Réutilisation de l'existant** : auth du portail, `push_subscriptions` + `send-push`, pattern cron
  `CRON_SECRET`, déploiement des edge functions via le CLI Supabase authentifié.

## 4. Architecture

### 4.1 Vue d'ensemble

```
[ Navigateur / PWA ]  ── page "Marketing IA" (nouvelle tuile du portail)
        │  (token de session Supabase)
        ▼
[ Edge Functions Supabase ]  ── agents IA (Orchestrateur, Contenu…), appels Claude, publication réseaux
        │
        ▼
[ Base Supabase ]  ── sociétés marketing, lignes éditoriales, cadences, posts, connexions réseaux, stats
        ▲
        │
[ pg_cron ]  ── déclenche périodiquement : génération à venir + publication des posts validés
```

### 4.2 Composants

- **Le tableau de bord (frontend)** : un fichier HTML/JS autonome (`marketing.html`) ajouté au repo
  `comptes-engco`, avec son manifeste PWA et son icône, réutilisant `sw.js` / `push.js`. Écrans :
  sélecteur de société, réglages (ligne éditoriale + cadence), calendrier éditorial, file « à valider »,
  historique + stats.
- **La base de données** : tables préfixées `mkt_` sur la base **unified-backend** (`lrslisyydbiejqzpsoxc`),
  RLS par utilisateur/société.
- **Les agents (edge functions)** :
  - **Orchestrateur** : reçoit les objectifs/cadences, décide quels posts produire et quand, route le
    travail, remonte ce qui a besoin de validation.
  - **Agent Contenu** : rédige le post (texte adapté au réseau + proposition de visuel/légende) selon
    la ligne éditoriale de la société.
  - (Phases ultérieures) Campagnes, Leads, Développement/Croissance.
- **Le planificateur (pg_cron)** : job périodique appelant une edge function qui (a) génère les posts
  manquants selon la cadence et (b) publie les posts validés dont l'heure est arrivée. Protégé par
  `CRON_SECRET` (même pattern que `rdv-reminders`).
- **Les connexions réseaux** : OAuth LinkedIn puis Meta ; jetons stockés de façon sécurisée ;
  publication via edge function dédiée.

### 4.3 Modèle de données (esquisse, à affiner dans le plan)

- `mkt_companies` — les sociétés (nom, activité, créé par user_id).
- `mkt_editorial` — ligne éditoriale par société (ton, cible, sujets, do/don't, langue).
- `mkt_cadence` — cadence par société × réseau (nb/semaine, jours, heures).
- `mkt_posts` — posts (société, réseau, contenu texte, idée visuel/légende, date planifiée,
  **statut** : brouillon / à_valider / validé / publié / refusé / en_pause, id externe après publication).
- `mkt_social_accounts` — connexions réseaux par société (réseau, jetons chiffrés, expiration) —
  **accès service-role uniquement**.
- `mkt_stats` — statistiques par post (impressions, likes, clics…) quand l'API les fournit.
- Réutilise `push_subscriptions` (déjà en place) pour les notifications.

### 4.4 Sécurité

- Clé Anthropic : secret Supabase (`ANTHROPIC_API_KEY`), jamais côté client.
- Jetons LinkedIn/Meta : stockés côté serveur, table à RLS restrictive (lecture service-role),
  chiffrés au repos ; le navigateur ne les voit jamais.
- RLS sur toutes les tables `mkt_` : un utilisateur ne voit que ses sociétés/posts.
- Edge functions vérifient le token de session (sauf cron, protégé par `CRON_SECRET`).

## 5. Découpage par phases (chaque phase livre du testable)

### Phase 1 — Squelette + génération + validation dans l'app (sans publication auto)
- Nouvelle tuile « Marketing IA » dans le portail (auth + PWA).
- Gestion de 2–3 sociétés ; par société : ligne éditoriale + cadence.
- Orchestrateur + agent Contenu génèrent des posts (texte + idée visuel/légende) via Claude (edge function).
- Calendrier éditorial + statuts + boutons **Valider / Modifier / Refuser** dans l'app.
- **Testable :** créer 2 sociétés, cliquer « Générer la semaine », voir/modifier/valider de vrais posts.
  Rien n'est publié dehors (volontaire : on valide la qualité d'abord).
- **En parallèle dès le début :** lancer la demande d'accès API LinkedIn (délai à anticiper).

### Phase 2 — Publication auto LinkedIn + planification à heure fixe
- Connexion OAuth LinkedIn.
- Un post validé se publie seul à l'heure prévue (cron pg_cron + edge function de publication).

### Phase 3 — Notifications push + validation depuis le mobile
- Notif « post prêt, tu valides ? » avec actions ; validation en un clic depuis le téléphone
  (réutilise `push_subscriptions` + `send-push`, même origine déjà validée iPhone).

### Phase 4 — Instagram / Facebook (Meta) + calendrier avancé + statistiques
- Connexion Meta (IG Pro + Page FB), publication auto IG/FB.
- Historique des publications + stats de base (impressions, likes, clics selon API).

### Phase 5 — Agents Marketing / Leads / Développement + communication inter-agents
- Agent Campagnes (thèmes cohérents dans la durée), agent Leads, agent Développement/Croissance.
- L'Orchestrateur coordonne réellement plusieurs agents.

## 6. Ce que David doit fournir / faire

- **Phase 1 :** clé API Anthropic (collée de façon sécurisée, procédure fournie) ; infos des 2–3
  sociétés (nom, activité, ton, cible) via un petit questionnaire guidé.
- **Dès le début (parallèle) :** Page LinkedIn + demande d'accès API (pas-à-pas fourni).
- **Phase 4 :** comptes Instagram en Pro reliés à une Page Facebook (pas-à-pas fourni).

## 7. Coûts estimés

- Supabase : gratuit (offre actuelle). GitHub Pages : gratuit.
- Claude API : paiement à l'usage — quelques € / mois pour ce volume de posts.
- Aucun outil tiers payant obligatoire (publication via APIs directes).

## 8. Hors périmètre (pour l'instant)

- Apps natives App Store (architecture PWA la permet plus tard, non prioritaire).
- Vente du logiciel à des clients externes (multi-tenant conçu pour les sociétés de David d'abord).
- Génération d'images IA (Phase 1 propose une *idée* de visuel ; la génération réelle est un ajout futur).
