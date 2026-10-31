# Fabriny Bakery

Site vitrine **et** système de commande de la boulangerie de quartier **Fabriny Bakery** (Lubumbashi, RDC) :
pains artisanaux, donuts et shawarma.

> Ce dépôt s'appelait auparavant `football-predictor` ; il a été réorienté vers le projet Boulangerie Fabriny Bakery.

---

## Ce que fait le site

**Côté client**

- Carte de 21 produits répartis en 4 familles : Pains, Donuts, Shawarma, Douceurs — filtrable sans rechargement.
- Panier persistant (localStorage) avec quantités, sous-total et frais de livraison calculés en direct.
- Commande sans compte : nom, téléphone, adresse si livraison, note pour le fournil.
- **Code de commande** (`FB-XXXXX`) délivré à l'envoi, avec lien WhatsApp pré-rempli.
- **Suivi de commande** en temps réel : Reçue → En préparation → Prête / En route → Récupérée.
- Statut d'ouverture calculé automatiquement (fuseau `Africa/Lubumbashi`).
- Retrait au comptoir (gratuit) ou livraison (2 000 FC, offerte dès 15 000 FC).

**Côté équipe** — `http://localhost:8000/admin`

- Connexion par clé d'accès.
- Tableau de bord : commandes du jour, commandes en cours, prêtes, recette du jour.
- Filtres par statut et changement d'état en un clic (accepter → prête → récupérée, ou annuler).
- Actualisation automatique toutes les 25 secondes.

---

## Stack

| Élément | Choix |
| --- | --- |
| Serveur | Node.js natif (`node:http`), **aucune dépendance npm** |
| Déploiement | Vercel (statique + fonction serverless `api/`) |
| Stockage | JSON sur fichier — ou Vercel KV / Upstash si configuré |
| Front-end | HTML, CSS et JavaScript natifs (aucun framework) |
| Polices | Fraunces & Plus Jakarta Sans, auto-hébergées (licence OFL) |
| Images | Générées pour le projet, dans `public/assets/` |

## Démarrage

```bash
npm start          # ou : node server.js
```

Le site est disponible sur **http://localhost:8000** et l'espace équipe sur **http://localhost:8000/admin**.

Variables d'environnement :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `8000` | Port d'écoute |
| `HOST` | `0.0.0.0` | Interface d'écoute |
| `ADMIN_KEY` | `fabriny2026` | Clé d'accès à l'espace équipe — **à changer en production** |

```bash
ADMIN_KEY="une-cle-solide" PORT=8080 npm start
```

---

## Structure

```
├── server.js              # serveur local : statique + API
├── api/[...path].js       # fonction serverless Vercel (mêmes routes)
├── lib/
│   ├── api.js             # cœur de l'API (indépendant du serveur)
│   ├── orders.js          # validation, totaux, statuts
│   ├── store.js           # persistance (KV / fichier / mémoire)
│   └── catalog.js         # lecture du catalogue et des paramètres
├── vercel.json            # configuration de déploiement
├── data/
│   ├── products.json      # catalogue : catégories, produits, prix
│   ├── shop.json          # infos boutique : horaires, téléphone, livraison
│   └── orders.json        # commandes (créé à la volée, non versionné)
└── public/
    ├── index.html         # boutique (hero, carte, panier, suivi)
    ├── styles.css         # design system + mise en page
    ├── app.js             # panier, commande, suivi
    ├── admin.html         # espace équipe
    ├── admin.css / admin.js
    ├── assets/            # photos + favicon
    └── fonts/             # polices OFL auto-hébergées
```

## API

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/config` | Infos boutique, catégories, statuts |
| `GET` | `/api/products` | Catalogue complet |
| `POST` | `/api/orders` | Crée une commande (prix et frais recalculés côté serveur) |
| `GET` | `/api/orders?code=FB-XXXX&phone=` | Suivi (le téléphone doit correspondre) |
| `GET` | `/api/admin-orders` | Liste des commandes *(clé requise)* |
| `PATCH` | `/api/admin-orders?code=FB-XXXX` | Change le statut *(clé requise)* |
| `GET` | `/api/health` | Sonde de disponibilité |

Exemple de commande :

```bash
curl -X POST http://localhost:8000/api/orders \
  -H 'content-type: application/json' \
  -d '{
    "mode": "livraison",
    "customer": { "name": "Fabrice N.", "phone": "+243 970 111 222" },
    "address": "Avenue Kasavubu 24, Bel-Air",
    "items": [{ "id": "pain-levain", "qty": 2 }, { "id": "shawarma-poulet", "qty": 1 }]
  }'
```

La clé d'administration se transmet via l'en-tête `x-admin-key` (ou `?key=`).

Les routes sont volontairement **plates** (`/api/orders?code=…`, `/api/admin-orders?code=…`) :
sur Vercel, les chemins d'API imbriqués ne sont pas toujours routés vers une fonction
*catch-all*. Les anciennes formes (`/api/orders/:code`, `/api/admin/orders[/:code]`)
restent acceptées par le serveur local.

### Garde-fous

- Prix, frais de livraison et totaux **recalculés côté serveur** : un panier falsifié ne peut pas modifier le montant.
- Validation stricte (nom, téléphone, adresse, quantités 1–20, 25 articles différents maximum).
- Limitation de débit sur la création de commande (25 par 5 minutes et par IP).
- Comparaison de la clé admin à temps constant, protection contre la traversée de répertoires.
- Téléphone masqué côté public : le suivi exige le code **et** les 8 derniers chiffres du numéro.

---

## Personnaliser

- **Prix, produits, descriptions** → `data/products.json`
- **Téléphone, WhatsApp, adresse, horaires, frais de livraison** → `data/shop.json`
- **Couleurs, typographie, arrondis** → variables CSS en tête de `public/styles.css`

Les coordonnées livrées sont des valeurs d'exemple (`+243 97 000 0000`, avenue Kasavubu) : **remplacez-les par les vraies coordonnées de la boutique** avant la mise en ligne.

## Déploiement sur Vercel

Le projet est prêt pour Vercel : le site statique sort de `public/`, l'API est servie par
`api/[...path].js`, et `vercel.json` s'occupe des réécritures (`/admin`, favicon), du cache et
de l'inclusion des fichiers `data/*.json` dans la fonction.

```bash
vercel            # préversion
vercel --prod     # production
```

Ou simplement connecter le dépôt GitHub au projet : chaque push sur `main` redéploie.

**Persistance des commandes.** Sur Vercel, le système de fichiers n'est pas durable.
`lib/store.js` choisit automatiquement son adaptateur :

| Situation | Adaptateur | Persistance |
| --- | --- | --- |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` définis | Vercel KV / Upstash (REST) | **durable** |
| Sur Vercel sans KV | fichier `/tmp` | à la durée de l'instance |
| En local | `data/orders.json` | durable |

Pour des commandes réellement persistantes en production, ajoutez un store Vercel KV
(ou une base Upstash) au projet : les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN`
sont détectées automatiquement, sans changement de code.

### Instance en production

| | |
| --- | --- |
| Site | https://fabriny-bakery.vercel.app |
| Espace équipe | https://fabriny-bakery.vercel.app/admin |
| Projet Vercel | `fabriny-bakery` (équipe `kilongo-muyeme`) |
| Déploiement | manuel depuis `main` (déploiement automatique désactivé) |

La clé d'administration de cette instance est définie par la variable d'environnement
`ADMIN_KEY` du projet Vercel (elle ne figure pas dans le dépôt).

## Notes de production

- Sauvegardez `data/orders.json` (ou branchez une base de données) : c'est le seul état persistant.
- Servez le site derrière HTTPS et changez `ADMIN_KEY`.
- Aucune dépendance npm ni build : un `node server.js` suffit, sur n'importe quel hébergeur Node.

## Crédits

Polices [Fraunces](https://fonts.google.com/specimen/Fraunces) et [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans),
distribuées sous SIL Open Font License (fichiers de licence dans `public/fonts/`).
