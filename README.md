# MACHIBEL - Systeme de gestion pour parfumerie

Voir [docs/PROJET_PARFUMERIE_BRIEF.md](docs/PROJET_PARFUMERIE_BRIEF.md) pour le brief complet.

## Structure

- `backend/` - API Node.js/Express
- `frontend/` - PWA Vue.js
- `render.yaml` - blueprint de deploiement (service web + base)
- `docker-compose.yml` - PostgreSQL **dev uniquement**
- `backups/` - sauvegardes locales (jamais commit, voir `.gitignore`)

## Dev local

```bash
# 1. Demarrer PostgreSQL (dev uniquement, jamais utilise en production)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
# editer .env : renseigner DB_PASSWORD=machibel, generer JWT_SECRET (voir ci-dessous),
# puis decommenter les 2 lignes DEV UNIQUEMENT (NODE_ENV=development, DB_PORT=5439)
npm install
npm run generate-secret   # genere un JWT_SECRET a coller dans .env
npm run dev               # http://localhost:3010
# Le demarrage applique les migrations et cree le compte admin tout seul.

# 3. Frontend
cd frontend
cp .env.example .env   # rien a modifier en dev, le fichier explique les cas ou c'est necessaire
npm install
npm run dev         # http://localhost:5174
```

Le backend refuse de demarrer si `DB_PASSWORD` ou `JWT_SECRET` sont absents ou
laisses a une valeur d'exemple (voir `backend/src/config/index.js`) — c'est
volontaire, pour ne jamais deployer avec un secret par defaut.

### Scripts utiles (backend)

| Commande | Role |
|---|---|
| `npm run generate-secret` | Genere un JWT_SECRET aleatoire a coller dans `.env` |
| `npm run migrate` | Applique les migrations a la main (le demarrage le fait deja) |
| `npm run backup` | Sauvegarde la base + `uploads/` dans `backups/` |
| `npm run restore -- <prefixe>` | Restaure une sauvegarde (voir `backend/scripts/restore.sh`) |
| `npm run check-integrity` | Verifie les invariants critiques (stock = somme des lots, etc.), sans rien modifier |

**Sauvegardes** : `npm run backup` doit tourner quotidiennement via une tache
planifiee (cron en dev, Planificateur de taches Windows en prod). Il sauvegarde
la base ET `uploads/` ensemble — la base ne stocke que les chemins des photos,
jamais les fichiers, donc les deux sont indissociables. 30 jours d'historique
sont conserves automatiquement.

## Premier demarrage et comptes

Au tout premier demarrage, le backend applique les migrations puis cree le compte
administrateur initial (voir [backend/src/db/bootstrap-admin.js](backend/src/db/bootstrap-admin.js)) :

| Identifiant | Mot de passe |
|-------------|--------------|
| `admin`     | `Machibel@2026` |

Ces identifiants sont **statiques et publics** (ils sont dans le code) :
**a changer des la premiere connexion**, ecran Parametres > Mon mot de passe.
La session reste ouverte apres le changement, sans repasser par l'ecran de connexion.

Les comptes suivants se creent depuis Parametres > Comptes administrateurs, avec
seulement un **prenom** et un **nom**. Le systeme genere :

- l'**identifiant** de connexion : `Jean-Marie` + `N'Doumbe` -> `jean-marie.ndoumbe`
  (accents retires, collisions suffixees : `jean-marie.ndoumbe2`) ;
- un **mot de passe** aleatoire affiche **une seule fois** a la creation.

Le mot de passe n'est stocke qu'en hash bcrypt : une fois la fenetre fermee, il
est irrecuperable. La personne le change ensuite elle-meme.

Le dernier compte administrateur actif ne peut pas etre desactive — il n'existe
aucune procedure de reinitialisation, cela fermerait le systeme definitivement.

## Configuration

Toute la configuration vit dans [backend/src/config/index.js](backend/src/config/index.js),
avec les valeurs de **production** en dur. En production, `backend/.env` ne
contient donc que **deux variables** :

```bash
DB_PASSWORD=...   # mot de passe du role PostgreSQL machibel
JWT_SECRET=...    # genere avec: npm run generate-secret
```

Si l'une des deux manque, le backend refuse de demarrer avec un message explicite
plutot que de tomber sur une valeur de repli silencieuse.

Le frontend n'a **aucune** variable a definir : le build de production cible
`/api` en relatif (le backend sert lui-meme la PWA), et `http://localhost:3010/api` en dev.

Valeurs figees dans le code, surchargeables via `.env` sur la machine de dev :

| Variable   | Defaut (production) | Dev |
|------------|---------------------|-----|
| `PORT`     | `3010`              | idem |
| `NODE_ENV` | `production`        | `development` |
| `DB_HOST`  | `localhost`         | idem |
| `DB_PORT`  | `5432` (Postgres natif Windows) | `5439` (conteneur Docker) |
| `DB_USER`  | `machibel`          | idem |
| `DB_NAME`  | `machibel`          | idem |

## Ports reserves pour ce projet (dev)

Cette machine de dev fait tourner plusieurs projets en parallele. Ports verifies
libres et retenus pour MACHIBEL :

| Service              | Port |
|----------------------|------|
| PostgreSQL (Docker)  | 5439 |
| Backend Express      | 3010 |
| Frontend Vite (dev)  | 5174 |

## Production : Render

Domaine : **<https://stock.schoolshub.org>**

Un seul service web. Le processus Node sert **a la fois l'API et la PWA compilee**
(`frontend/dist`) : meme origine, pas de reverse proxy a installer, pas de CORS
entre le front et l'API. Render s'occupe du TLS et du domaine.

Le blueprint [render.yaml](render.yaml) decrit le service et sa base ; il suffit
de pointer Render sur ce depot.

**Build** : `npm run build` a la racine (installe les deux paquets et compile la PWA)
**Demarrage** : `npm start` (migrations, compte admin, puis ecoute)

### Variables d'environnement (2)

| Variable | Origine |
|---|---|
| `DATABASE_URL` | Injectee automatiquement par Render quand la base est rattachee au service |
| `JWT_SECRET` | A definir a la main. Generer avec `npm run generate-secret` |

Tout le reste est fige dans `backend/src/config/index.js`. `PORT` est impose par
Render et lu tel quel.

### Point d'attention : les photos

Le disque d'un service Render est **ephemere**. Les fichiers de `backend/uploads/`
(photos produits, logo) sont **perdus a chaque redeploiement** tant qu'un disque
persistant n'est pas attache et monte sur ce chemin. La base, elle, est un service
separe et n'est pas concernee.

## Docker = dev uniquement

Le conteneur `parfumerie-machibel-postgres-dev` (voir `docker-compose.yml`) ne
sert qu'a simuler PostgreSQL pendant le developpement sur cette machine Ubuntu,
qui n'a pas Postgres installe en dur et qui heberge d'autres projets en
parallele. Le code applicatif n'a aucune dependance a Docker.
