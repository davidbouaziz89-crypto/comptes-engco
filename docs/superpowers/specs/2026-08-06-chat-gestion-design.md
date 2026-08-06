# Chat interne « gestion » — Design

Date : 2026-08-06
Dépôt : `comptes-engco` (apps HTML autonomes, une seule base Supabase `lrslisyydbiejqzpsoxc`, domaine `gestion.proformationplus.fr`).

## 1. Objectif

Ajouter un **chat type Messenger** disponible sur **tout le site gestion** (portail + tous les logiciels) : messagerie entre tous les utilisateurs, présence en ligne, discussions de groupe, notifications (in-app + push web) et pièces jointes.

Une seule bulle en bas à droite, cohérente d'une app à l'autre, la conversation suit l'utilisateur partout.

## 2. Périmètre

**Inclus (V1)** : messages 1:1, groupes, présence en ligne/hors ligne, compteur de non-lus, notifications in-app (badge + son + toast) **et** push web, pièces jointes (images + fichiers), avatars (portraits + genre déjà en place).

**Exclus (plus tard)** : appels audio/vidéo, réactions emoji, fils de réponse, messages éphémères, édition de message, recherche plein-texte avancée, accusés de lecture par message (on gère les non-lus au niveau conversation).

## 3. Décisions validées

- Déploiement : **toutes les apps d'un coup** (portail + 8 logiciels).
- Notifications : **in-app + push web** (réutilise `send-push` + `push_subscriptions`).
- V1 = **fonctionnalité complète** (1:1 + groupes + présence + fichiers + notif).
- Historique : **conservé** (pas d'auto-suppression).
- Droits : **tout le monde peut écrire à tout le monde**, tout membre peut créer un groupe.

## 4. Architecture

### 4.1 Widget partagé
- Deux fichiers : `chat.js` (logique) + `chat.css` (styles), à la racine du repo.
- Inclus par **une seule ligne** dans chaque app, juste avant `</body>` :
  `<script defer src="./chat.js"></script>`
  (le JS injecte lui-même son `<link>` CSS et son conteneur DOM, donc pas d'autre modif HTML).
- Le widget crée **son propre client Supabase** (mêmes `SUPABASE_URL` + clé publiable que les apps — constantes publiques) pour ne pas dépendre du nommage interne (`db`/`sb`) propre à chaque app. Il lit la **session existante** (auth partagée sur le domaine) ; si non connecté, le widget ne s'affiche pas.
- Isolation : tout le CSS est préfixé `.egc-chat*` et encapsulé pour ne pas entrer en conflit avec les styles des apps.

### 4.2 Temps réel
- **Supabase Realtime** :
  - *Presence* : un canal global `presence:gestion` où chaque widget ouvert `track()` `{user_id, email}` → liste des connectés en direct.
  - *postgres_changes* : abonnement aux `INSERT` sur `chat_messages` filtrés par les conversations de l'utilisateur → réception instantanée.
- Repli : si Realtime indisponible, un rafraîchissement léger au focus de la fenêtre (pas de polling agressif).

## 5. Modèle de données (nouvelles tables `chat_*`)

```
chat_conversations
  id              uuid pk default gen_random_uuid()
  type            text check (type in ('direct','group'))
  title           text                     -- null pour direct (titre = nom de l'autre)
  created_by      uuid references auth.users
  created_at      timestamptz default now()
  last_message_at timestamptz default now() -- pour trier les conversations

chat_members
  id              uuid pk default gen_random_uuid()
  conversation_id uuid references chat_conversations on delete cascade
  user_id         uuid references auth.users
  email           text
  role            text default 'member'    -- 'admin' = créateur du groupe
  last_read_at    timestamptz default now()-- compteur de non-lus
  muted           boolean default false
  joined_at       timestamptz default now()
  unique(conversation_id, user_id)

chat_messages
  id              uuid pk default gen_random_uuid()
  conversation_id uuid references chat_conversations on delete cascade
  sender_id       uuid references auth.users
  sender_email    text
  body            text                     -- peut être vide si message = fichier seul
  created_at      timestamptz default now()
  deleted         boolean default false

chat_attachments
  id              uuid pk default gen_random_uuid()
  message_id      uuid references chat_messages on delete cascade
  path            text                     -- chemin dans le bucket privé
  name            text
  mime            text
  size            integer
```

Index : `chat_messages(conversation_id, created_at)`, `chat_members(user_id)`, `chat_conversations(last_message_at)`.

Unicité des conversations directes : une fonction `chat_get_or_create_direct(other_user_id)` (SQL, SECURITY DEFINER) renvoie la conversation directe existante entre les 2 users ou la crée — évite les doublons.

## 6. Sécurité (RLS)

RLS activé sur les 4 tables. Principe : **on n'accède qu'à ce dont on est membre**.

- Fonction helper `chat_is_member(conv uuid, uid uuid) returns boolean` (SECURITY DEFINER) pour éviter la récursion RLS.
- `chat_conversations` : SELECT si `chat_is_member(id, auth.uid())`. INSERT via la fonction `chat_get_or_create_direct` ou une fonction `chat_create_group`.
- `chat_members` : SELECT si membre de la même conversation. INSERT/DELETE encadrés (créateur du groupe pour ajouter/retirer ; chacun peut se retirer).
- `chat_messages` : SELECT si membre ; INSERT si membre **et** `sender_id = auth.uid()`.
- `chat_attachments` : suit les droits du message parent.

Realtime respecte la RLS (abonnement `postgres_changes` filtré côté serveur par les policies).

## 7. Edge functions

- **`chat-directory`** (auth requise, tout utilisateur) : renvoie l'annuaire des collègues `{user_id, email, display_name, genre}` (service role, à partir de `auth.users` + métadonnées) pour démarrer une discussion et afficher les avatars. Ne renvoie pas de données sensibles.
- **`chat-notify`** (auth requise) : appelée par le widget après l'envoi d'un message. Vérifie que l'appelant est membre, puis envoie une **notification push** (réutilise la logique `send-push` + `push_subscriptions`) à chaque autre membre **non muté**. Charge utile : titre = nom de l'expéditeur / du groupe, corps = extrait du message, `data.url` = lien profond vers la conversation. Idempotent et « fire-and-forget » côté client.

L'insertion du message se fait **directement par le client** (RLS), pour un temps réel simple ; `chat-notify` ne gère que le push.

## 8. Interface du widget (style Messenger)

- **Bulle flottante** bas-droite : icône 💬 + pastille rouge de non-lus (total).
- **Panneau** (ouverture au clic) :
  - En-tête : « Messages » + bouton « ✏️ Nouveau » (nouvelle discussion / groupe) + recherche.
  - **Liste** triée par `last_message_at` : avatar (portrait+genre), nom, dernier message, heure, **point vert si en ligne**, badge non-lus. Section « En ligne » en haut.
  - **Nouvelle discussion** : annuaire des collègues (avec point de présence) ; sélection multiple → propose un **nom de groupe**.
- **Vue conversation** :
  - En-tête : avatar(s) + nom + statut (en ligne / vu récemment) + retour.
  - **Fil** de messages (bulles gauche/droite), séparateurs de jour, vignettes d'images, blocs fichiers téléchargeables.
  - **Saisie** : champ texte, **📎 pièce jointe**, envoi (Entrée). Indicateur « en train d'écrire » (optionnel V1.1).
- **Responsive** : < 640 px, le panneau passe en **plein écran**.
- **Accessibilité** : focus visible, `prefers-reduced-motion` respecté, contrastes ok en thèmes clair/sombre.

## 9. Notifications

- **In-app** : recalcule le total de non-lus → badge sur la bulle ; à la réception d'un message (widget fermé ou autre conversation), **toast** discret + **petit son** (désactivable). 
- **Push web** : `chat-notify` pousse aux membres non mutés. Le Service Worker (déjà présent, `sw.js`) gère l'affichage et le clic → ouvre l'app sur la conversation (`?chat=<conversation_id>` ou hash). Ajout d'un handler `notificationclick` si absent.
- **Anti-bruit** : pas de push pour ses propres messages ; respect du `muted` par conversation.

## 10. Fichiers / pièces jointes

- Bucket Storage **privé `chat-files`**, chemin `conversation_id/message_id/nom`.
- Upload depuis le widget → insertion `chat_attachments`.
- Lecture via **URL signée** générée à la demande (RLS storage : membre de la conversation). Politique storage basée sur l'appartenance (via une fonction helper).
- Limites : taille max par fichier (ex. 25 Mo), types courants (images, pdf, bureautique). Images rendues en vignette, reste en lien.

## 11. Déploiement / rollout

1. Migrations SQL : tables + index + RLS + fonctions (`chat_is_member`, `chat_get_or_create_direct`, `chat_create_group`) + bucket `chat-files` + policies storage. (À appliquer par David ou via CLI — le MCP est en lecture seule.)
2. Edge functions `chat-directory` + `chat-notify` (déploiement CLI).
3. `chat.js` + `chat.css` (construits par incréments : 1:1 → groupes → fichiers → notif).
4. Inclusion de la ligne `<script defer src="./chat.js"></script>` dans les 9 apps.
5. Tests navigateur (2 comptes) : présence, envoi/réception temps réel, non-lus, groupe, fichier, push.
6. Commit + push (déploiement GitHub Pages).

## 12. Tests / critères de réussite

- Deux utilisateurs voient l'état en ligne l'un de l'autre en < 2 s.
- Message envoyé apparaît chez le destinataire en temps réel sans rechargement.
- Le badge de non-lus est correct et se remet à zéro à l'ouverture de la conversation.
- Un groupe de 3 fonctionne (tous reçoivent).
- Une image et un PDF s'envoient et s'ouvrent via URL signée ; un non-membre ne peut pas y accéder.
- Une notification push arrive sur un compte dont l'app est fermée ; le clic ouvre la bonne conversation.
- RLS : un utilisateur ne peut lire aucune conversation dont il n'est pas membre (vérifié par requête directe).
- Aucun conflit visuel/JS avec les apps existantes (chargement sans erreur console sur les 9 pages).

## 13. Risques / points d'attention

- **Récursion RLS** entre `chat_members` et `chat_conversations` → contournée par fonctions `SECURITY DEFINER`.
- **Coût Realtime** : un canal presence global + abonnements par conversation ; rester dans les quotas Supabase (nombre de connexions simultanées faible ici, ~dizaines).
- **Isolation CSS/JS** dans des apps hétérogènes → préfixe `.egc-chat`, pas de variables globales qui fuient.
- **Service Worker** : vérifier que `notificationclick` route bien vers la conversation dans chaque scope d'app.
- **Compta multi-sociétés** est une base séparée : hors périmètre de ce chat (backend différent).
