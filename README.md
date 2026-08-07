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
| `npm run seed-demo` | Repose le jeu de demonstration **en effacant tout le contenu metier** |
| `npm run amorcer-demo` | Meme chose, mais uniquement si la base est vide (ce que fait le demarrage) |
| `npm run preparer-photos-demo` | Reconstitue `backend/seed-assets/photos/` a partir des services d'images |

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

## Jeu de demonstration

Sur une base **entierement vide**, le demarrage pose de lui-meme un historique
complet allant de janvier 2024 a aujourd'hui : 16 employes avec arrivees,
promotions et departs, 8 vendeuses, 86 produits, 10 fournisseurs, plus de
6 000 ventes, les cycles de paie et leurs recus, les dossiers du personnel et
le journal d'audit correspondant. Voir
[backend/src/db/amorcage-demo.js](backend/src/db/amorcage-demo.js).

C'est ce qui permet d'obtenir un systeme rempli en ligne sans avoir de terminal
sur le serveur : le prochain deploiement s'en charge.

**Ce qui l'empeche de nuire :**

- il ne s'execute **que si toutes les tables metier sont vides**. Une base qui
  porte le moindre produit, la moindre vente ou le moindre employe n'est pas
  touchee, et le journal le dit explicitement ;
- une fois `applique`, c'est definitif : il ne revient pas au deploiement
  suivant, meme si la base a ete videe depuis (table `amorcages`). Un refus
  (`ignore`), lui, est reevalue a chaque demarrage : la base occupee ce jour-la
  peut avoir ete videe depuis, et il ne faut pas devoir intervenir en base pour
  effacer un refus devenu caduc ;
- il tourne **apres** l'ouverture du port, en tache de fond. Le service repond
  normalement pendant les quelques minutes que dure le remplissage ;
- il est transactionnel : interrompu, il ne laisse rien derriere lui.

| `AMORCAGE_DEMO` | Effet |
|---|---|
| *(non defini)* | Comportement decrit ci-dessus |
| `non` | N'amorce jamais rien (base de dev qu'on veut garder vide) |
| `completer` | Pose le jeu **a cote** de ce qui existe, sans rien effacer |
| `forcer` | Pose le jeu **apres avoir tout efface** |
| `completer-2`, `forcer-mars`... | Idem, pour agir une nouvelle fois plus tard |

`completer` est le bon reglage quand la base porte deja quelques fiches de test
qu'on prefere garder : les fonctions homonymes sont reutilisees au lieu d'etre
dupliquees, et les identifiants ne repartent pas de 1 — sans importance, tout le
remplissage travaille avec les identifiants reellement rendus par les `INSERT`.

Ces deux reglages n'agissent qu'**une seule fois par valeur**, et c'est
essentiel : la variable se regle dans la console de l'hebergeur, ou elle reste
en place tant qu'on ne l'a pas retiree. Si elle agissait a chaque lecture, un
service qui se met en veille toutes les quinze minutes rejouerait le
remplissage a chaque reveil, effacant le travail reel saisi entre temps. La
valeur employee est donc conservee dans le marqueur ; pour agir a nouveau, on en
ecrit une differente.

Les photos du jeu (produits, portraits, pieces des dossiers) sont versionnees
dans `backend/seed-assets/photos/`, et non telechargees au demarrage. Deux
raisons : dependre de services d'images tiers au moment precis d'un deploiement
donnerait un catalogue sans photos le jour ou ils limitent le debit ; et surtout
le plan gratuit n'a pas de disque persistant, donc `uploads/` est vide a chaque
reveil du service. Le demarrage y repose les photos manquantes a partir du lot,
en s'appuyant sur la correspondance conservee dans `amorcages.resume`.

Pour **repartir d'un systeme neuf** chez le client : vider les tables metier,
puis passer `amorcages.etat` a `ignore` — ou simplement demarrer une fois avec
`AMORCAGE_DEMO=non`.

## Le logo survit aux redemarrages

Le plan gratuit n'a pas de disque persistant : `uploads/` est vide a chaque
reveil du service. Les photos de demonstration sont reposees depuis le lot
versionne du depot, mais le logo vient de l'exploitant et ne peut etre
versionne nulle part. Un logo envoye depuis Parametres disparaissait donc au
premier reveil, et l'en-tete de l'application comme celui de tous les PDF se
retrouvait vide sans que rien ne le signale.

L'envoi ecrit desormais l'image **dans la base** en plus du disque
(`parametres.logo_donnees`), et le demarrage la repose dans `uploads/` si le
fichier manque. Une image, quelques dizaines de kilo-octets, modifiee une fois
par an : le cout est negligeable et c'est le seul endroit qui survit.
`logo_path` reste la source pour tout le reste du code — ni le service PDF ni
le frontend n'ont bouge.

Si le chemin pointe dans le vide et que la base n'a pas de copie — un logo
envoye avant cette version — le demarrage revient au logo livre avec le depot
et le dit dans le journal. Il suffit de renvoyer le sien.

## Mises a jour des donnees deja en place

Les migrations font evoluer le schema ; elles ne peuvent rien pour les donnees
deja saisies. Quand une version ajoute une notion — le rayon et la marque d'un
produit, par exemple — les lignes existantes arrivent vides et le restent : la
fonctionnalite est en place mais ne montre rien, et il n'y a ni terminal ni
acces direct a la base pour reprendre le catalogue a la main.

Les **enrichissements** comblent ce trou. Ce sont des traitements de donnees
nommes, joues une seule fois par base, au demarrage, juste apres les migrations
et avant l'ouverture du port. Voir
[backend/src/db/enrichissements/](backend/src/db/enrichissements/).

| Enrichissement | Effet |
|---|---|
| `001-rayons-produits` | Cree les 9 rayons et classe les produits existants d'apres leur nom |
| `002-marques-demonstration` | Cree les marques du catalogue de demonstration et les attribue |

Les regles a retenir pour en ecrire un :

- il doit rester **court**. Le port n'est pas encore ouvert : le remplissage
  long, c'est l'amorcage, qui tourne apres l'ecoute ;
- il ne touche que les lignes **non renseignees** (`WHERE categorie_id IS NULL`)
  et n'ecrase jamais une valeur posee a la main ;
- ce qu'il ne sait pas deduire, il le **laisse vide**. Un rayon faux coute plus
  cher a l'exploitant qu'un rayon vide, et c'est pourquoi le classement se
  deduit du nom du produit : un article dont le nom ne dit rien reste sans
  rayon plutot que d'atterrir dans un fourre-tout ;
- ce qui ne vaut que pour la demonstration se protege derriere le marqueur
  `amorcages` (`002` ne s'applique pas sur la base d'un vrai commerce : aucune
  regle ne peut deviner le fabricant d'un article sans risquer de coller un
  nom faux sur de la vraie marchandise) ;
- s'il n'a rien a traiter pour l'instant, il ne s'inscrit pas et sera reexamine
  au demarrage suivant. C'est ce qui permet a une base vide au demarrage de
  recevoir quand meme le traitement une fois amorcee — le serveur repasse
  derriere l'amorcage pour cette raison ;
- une entree livree ne se modifie plus : une base qui l'a deja jouee ne la
  rejouera pas. Un correctif se livre sous un nouveau numero.

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

### Limites du plan gratuit

Le blueprint est configure en `plan: free` pour le service **et** pour la base.
Trois consequences a connaitre avant de mettre en service :

| Limite | Effet concret |
|---|---|
| Pas de disque persistant (reserve aux plans payants) | Les photos produits et le logo (`backend/uploads/`) sont **perdus a chaque redemarrage**, pas seulement aux deploiements. Les fiches produits restent, avec un chemin de photo qui ne pointe plus sur rien. |
| Base gratuite a duree limitee (~30 jours) | **Toutes les donnees sont supprimees** a l'echeance si la base n'est pas passee en plan payant avant. |
| Mise en veille apres ~15 min sans trafic | La premiere requete suivante peut prendre ~1 minute (demarrage a froid + migrations). |

La base n'est pas concernee par la perte des fichiers : c'est un service separe.
Seules les **images** disparaissent.

Pour lever ces limites : passer le service en `plan: starter` et **decommenter le
bloc `disk`** dans [render.yaml](render.yaml), puis passer la base en plan payant.

En attendant, `npm run backup` (base + `uploads/`) est le seul filet : a lancer
regulierement depuis un poste qui a acces a la base.

## Docker = dev uniquement

Le conteneur `parfumerie-machibel-postgres-dev` (voir `docker-compose.yml`) ne
sert qu'a simuler PostgreSQL pendant le developpement sur cette machine Ubuntu,
qui n'a pas Postgres installe en dur et qui heberge d'autres projets en
parallele. Le code applicatif n'a aucune dependance a Docker.
