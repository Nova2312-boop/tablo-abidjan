# Tablô Abidjan

Plateforme de réservation de restaurants pour Abidjan et ses communes, inspirée d'OpenTable.
Prototype pour le **Hackathon Restauration Vatel × Epitech** (Abidjan, 21 novembre 2026).

## Lancer le projet

Prérequis : **Node.js 18+** et **PostgreSQL** (testé avec PostgreSQL 18).

1. Crée la base (une seule fois) :
   ```
   psql -U postgres -c "CREATE DATABASE tablo;"
   ```
2. Copie `.env.example` en `.env` et mets ton mot de passe PostgreSQL dans `DATABASE_URL`.
3. Installe et démarre :
   ```
   npm install
   npm start
   ```
4. Ouvre :
   - Site client : http://localhost:3000
   - Espace restaurateur (admin) : http://localhost:3000/#pro

Les tables sont créées automatiquement au premier démarrage (`server/schema.sql`), avec un admin et un client de démo.
Ne plus ouvrir `index.html` directement ni avec Live Server : le site a besoin du serveur pour l'API.

## Comptes de démo

- **Client** : numéro `07 00 00 00 00` (Aya Koné, 650 pts, réservations d'exemple), ou n'importe quel autre numéro pour créer un compte. En mode démo, le code SMS s'affiche à l'écran.
- **Administrateur** : http://localhost:3000/#pro avec `admin@tablo.ci` / `Tablo2026!` (modifiable dans `.env` avant le premier démarrage).

## Rejoindre Tablô (parcours restaurateur)

1. **Demande** : le restaurant remplit le formulaire de `#inscription-resto`. Aucun compte n'est créé à ce stade.
2. **Échange** : l'équipe (rôle `super`) ouvre l'onglet « Demandes » et planifie un appel ou un entretien sur place (le gérant est prévenu par SMS et e-mail). Après l'échange, elle clique « Échange réalisé » puis « Créer le compte ». Le serveur refuse de créer un compte tant que l'échange n'est pas marqué comme réalisé.
3. **Activation** : le gérant reçoit un lien valable 7 jours, à usage unique, et choisit son mot de passe. Si l'e-mail n'est pas configuré, le lien s'affiche pour être envoyé par WhatsApp.
4. **Configuration** : dans « Ma fiche & configuration » : informations, photos, menu, plan de salle, services et disponibilités. Puis « Envoyer pour publication ».
5. **Publication** : l'équipe vérifie dans « Établissements » et clique « Publier ». Une fiche incomplète ne peut pas être publiée.

**Offres** : définies dans `PLANS` (`js/data.js`). La facturation n'est pas automatisée : le plan est seulement enregistré. Essentiel masque Cuisine et Statistiques ; plusieurs établissements : Premium.

**Disponibilités** (`js/slots.js`, partagé navigateur et serveur) : un créneau est libre si un service est ouvert et qu'une table adaptée reste libre pendant la durée du repas. Un groupe peut occuper plusieurs tables d'une même zone. Le serveur verrouille le restaurant pour la date pendant l'attribution, donc deux clients ne peuvent pas obtenir la même table. Les clients installés sans réservation occupent aussi leur table. Les restaurants d'exemple gardent des données de démonstration ; un vrai établissement n'affiche que ses vraies données.

## Automatismes

- **Rappel SMS** 2 h avant le repas, une seule fois (contrôle toutes les 5 minutes). Le serveur doit tourner à l'heure d'Abidjan : `TZ=Africa/Abidjan`.
- **Alerte « table libérée »** : quand un client annule ou est marqué no-show, ceux qui ont activé une alerte reçoivent une notification et un SMS, une seule fois.
- **Anti-gaspi** : une offre publiée par le restaurant (offres Pro et Premium) apparaît sur l'accueil et sa page. Le client réserve une portion, reçoit un code et paie au retrait. L'offre s'arrête le soir même.
- **Commandes** : un établissement active « à emporter » et/ou « livraison » dans sa fiche (étape 6). Le client commande depuis le menu, le serveur recalcule les prix et le restaurant fait avancer la commande dans l'onglet « Commandes » (client prévenu par notification et SMS). Le paiement se fait au retrait ou à la livraison ; la livraison est assurée par le restaurant.
- **Avis** : un avis par visite confirmée, visible par tous avec le nom masqué (« Aya K. »). Le restaurant peut répondre.
- **Relevé du mois** : abonnement + clients venus via Tablô. C'est une base de facturation, rien n'est encaissé.

## Avant une mise en production

Dans `.env` : `DEMO_OTP=0` (masque le code et l'accès démo), `ADMIN_PASSWORD` fort avant le premier démarrage, `PUBLIC_URL=https://…`, `TZ=Africa/Abidjan`, les clés LeTexto et Resend, et une vraie base PostgreSQL avec sauvegardes.

## Mise en ligne sur Render

Le fichier `render.yaml` décrit le serveur et la base. Sur Render : New > Blueprint, choisir le dépôt GitHub, puis remplir les valeurs demandées. Le mot de passe admin est généré par Render : voir `ADMIN_PASSWORD` dans Environment. L'offre gratuite met le serveur en veille après 15 minutes sans visite (premier chargement lent, rappels SMS en pause), et sa base gratuite expire au bout de 30 jours.

## Structure

```
tablo-abidjan/
├── index.html          # Squelette : en-tête, <main> rempli par le JS, pied de page, fenêtre modale
├── css/style.css       # Styles, thème clair/sombre, responsive mobile
├── js/data.js          # Catalogue : communes, restaurants, menus, expériences
├── js/slots.js        # Calcul des disponibilités (navigateur et serveur)
├── js/app.js           # Front : routage, vues, réservation, compte, espace resto (appelle l'API)
├── server/server.js    # Backend Node : API REST + fichiers statiques
├── server/schema.sql   # Schéma PostgreSQL
├── .env.example        # Modèle de configuration (copier en .env)
└── package.json        # Dépendance : pg
```

## Pages (routage par #)

| Adresse | Vue |
|---|---|
| `#accueil` | Recherche, « Décris ton envie », collections, expériences, FAQ, annuaire par commune |
| `#explorer` | Résultats filtrés, vue liste ou carte d'Abidjan |
| `#r-<id>` | Fiche restaurant (ex. `#r-kaya`) : menu, photos, avis, accès, réservation |
| `#compte` | Réservé aux clients connectés : réservations, historique, favoris, alertes, fidélité |
| `#pro` | Réservé aux admins : service et salle, cuisine et anti-gaspillage, statistiques |

## Backend

- **Base de données PostgreSQL** : utilisateurs, réservations, avis, sessions, admins, état de la salle par restaurant.
- **Clients** : connexion par code à usage unique (OTP) par SMS ou e-mail, session de 30 jours dans un cookie HttpOnly. Avec `DEMO_OTP=1`, le code s'affiche à l'écran car aucun fournisseur SMS n'est branché.
- **Admins** : e-mail + mot de passe **haché (scrypt + sel)**, blocage de 15 min après 5 échecs, session de 24 h.
- **Double réservation impossible** : un index unique PostgreSQL garantit un seul client par créneau confirmé.
- **Points calculés par le serveur** : réservation +50, annulation −50, visite confirmée par le restaurant +100, avis +30.
- **Lien client ↔ restaurant** : la réservation d'un client apparaît dans l'espace restaurateur. Quand le restaurant clique « Arrivé », le client reçoit ses points et une notification.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/auth/otp` · `/api/auth/verify` · `/api/auth/register` · `/api/auth/logout` | Connexion client |
| GET / PUT | `/api/me` · `/api/me/profile` · `/api/me/state` | Compte, profil, favoris, alertes |
| POST / PATCH | `/api/reservations` · `/api/reservations/:id` | Réserver, modifier, annuler |
| GET | `/api/availability?date=` | Tables occupées par restaurant |
| POST | `/api/reviews` · `/api/rewards/redeem` | Avis, échange de points |
| POST | `/api/admin/login` · `/api/admin/logout` | Connexion admin |
| POST | `/api/pro/demande` · `/api/pro/activation` | Demande de contact, activation du gérant |
| GET / PATCH / POST | `/api/admin/leads` · `/api/admin/leads/:id` · `/api/admin/leads/:id/compte` | Suivi des demandes, création du compte |
| GET / PUT / POST | `/api/admin/restaurants/:id` · `.../photos` · `.../soumettre` · `.../status` | Fiche, photos, envoi et publication |
| GET / PUT | `/api/admin/resto/:rid` | Salle, liste d'attente, stock + réservations clients |
| PATCH | `/api/admin/reservations/:id` | Arrivé / no-show (crédite le client) |

**SMS et e-mails réels** (`server/messaging.js`, mêmes fournisseurs que le projet AUKAZ) :
- SMS via **LeTexto** : `SMS_PROVIDER=letexto`, `LETEXTO_API_KEY`, `LETEXTO_SENDER_NAME`.
- E-mails via **Resend** : `RESEND_API_KEY`, `EMAIL_EXPEDITEUR` (adresse d'un domaine vérifié dans Resend).
- Messages envoyés : code de connexion, confirmation et annulation de réservation, « merci de ta visite », « ta table est prête » (liste d'attente).
- Sans clés, rien n'est envoyé : le message est seulement écrit dans la console du serveur. `/api/health` indique si l'envoi est réel ou simulé.

Toujours simulés : les paiements Wave / Orange Money / MTN MoMo. Le catalogue des restaurants reste dans `js/data.js`.

## Pistes pour la suite

- Brancher un fournisseur SMS (Orange, MTN, Twilio) et passer `DEMO_OTP=0`.
- Paiement réel via un agrégateur mobile money (CinetPay, PayDunya…).
- Déplacer le catalogue des restaurants dans PostgreSQL, avec un admin par restaurant.
- Rappels SMS / WhatsApp automatiques 2 h avant la réservation.
- Version mobile (PWA) avec QR code de commande à table.
