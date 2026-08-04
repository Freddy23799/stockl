# Projet : Système de gestion pour parfumerie (client MACHIBEL)

## Contexte

Le client MACHIBEL est une parfumerie avec boutique physique. Les ventes se font
de deux façons : directement en boutique, ou via des vendeuses qui démarchent
hors boutique. Le client a besoin d'un outil pour suivre ses ventes, son stock,
ses dépenses, et la performance de ses vendeuses.

## Fonctionnalités attendues

### Produits (catalogue)
- Module de création/gestion des produits, **en amont** de tout le reste : nom du
  produit, prix de vente (numérique), et toute autre caractéristique utile
- Un produit doit exister dans ce catalogue **avant** de pouvoir apparaître dans
  une entrée de stock ou dans une vente
- Modification/désactivation d'un produit existant possible depuis ce module
- **Unités de mesure et conversion** : chaque produit a une unité de stock de
  référence (pièce, mL, g...) utilisée en interne pour tous les calculs, et
  éventuellement une unité d'achat différente (carton, bidon, kg...) avec un
  facteur de conversion défini sur la fiche produit (ex: 1 carton = 24 pièces).
  À l'entrée de stock, on saisit le prix dans l'unité d'achat choisie ; le
  système convertit et stocke automatiquement le coût par unité de référence.
- **Historisation des prix** : le prix de vente d'un produit peut changer dans
  le temps. Chaque changement de prix doit être tracé (date, ancien prix,
  nouveau prix, auteur) dans l'Historique. **Règle stricte : chaque vente
  enregistrée fige (snapshot) le prix de vente et le coût d'acquisition
  appliqués à l'instant précis de la vente — une vente n'est jamais recalculée
  avec les valeurs actuelles du produit.** Un changement de prix n'affecte que
  les ventes futures ; les ventes passées et les rapports historiques restent
  exacts pour toujours.
- **Photo produit** : chaque fiche produit peut avoir une photo. Stockage en
  **fichier sur disque** (`uploads/produits/`, nom unique par produit — ex.
  l'id du produit), la base de données ne stocke que le **chemin/nom de
  fichier** (colonne texte), jamais l'image en BLOB. Le frontend affiche
  l'image directement via son chemin (fichier statique), sans passer par une
  requête base pour la récupérer : base plus légère et rapide, affichage
  instantané. Le dossier `uploads/` doit être sauvegardé en même temps que la
  base de données pour ne jamais perdre les photos.

### Gestion des vendeuses
- Fiche vendeuse : nom, et éventuellement contact — indépendamment d'un compte de connexion
- Cette liste de vendeuses sert de référence pour attribuer une vente et pour
  générer les rapports de performance par vendeuse
- Activation / désactivation d'une vendeuse (ex : fin de collaboration), sans
  supprimer l'historique de ses ventes passées

### Ventes
- Enregistrement d'une vente : produit(s), quantité, montant, date/heure automatique
- Deux types : vente directe (boutique) ou vente attribuée à une vendeuse nommée
- Décrémentation automatique du stock à chaque vente

### Stock
- Fiche produit avec quantité en stock + seuil d'alerte minimum
- Entrée de stock (ravitaillement) : quantité + coût d'achat
- Sortie de stock automatique à chaque vente
- Alerte visuelle quand un produit atteint son seuil critique
- Valorisation du stock au choix : **FIFO** ou **CMP** (coût moyen pondéré),
  configurable une fois pour tout le système

### Fournisseurs (ajout au brief initial)

- Fiche fournisseur : nom, contact, actif/inactif (désactivation seulement,
  jamais de suppression si des achats existent)
- Chaque entrée de stock peut être rattachée à un fournisseur
- Historique des achats par fournisseur, et total acheté par fournisseur
  (montant, quantités, sur une période donnée)

### Dépenses
- Enregistrement des dépenses courantes (électricité, eau, transport, etc.)
- Catégorie, montant, date, note libre
- Intégrées dans le calcul du bilan net

### Rapports
- Journalier, hebdomadaire, mensuel, annuel
- Chiffre d'affaires total (direct + vendeuses)
- Quantités vendues / achetées
- Détail par vendeuse : montant vendu, nombre de ventes, taux de contribution
- Bilan net : revenus − dépenses − coût des marchandises vendues (FIFO/CMP)
- La Vendeuse n'a accès qu'à un mini-rapport limité à ses propres ventes
- **Prévisualisation obligatoire du rapport à l'écran avant tout export/impression**

### Paramètres (Admin uniquement)
- Page dédiée à la configuration de la plateforme
- Gestion du **logo de la boutique**, réutilisé en en-tête de tous les documents
  générés (rapports, et tout autre document exporté)
- Espace prévu pour d'éventuels autres réglages globaux (méthode FIFO/CMP par défaut, etc.)

### Historique / audit (Admin uniquement)
- Liste de toutes les opérations : ventes, entrées/sorties de stock
- Qui a fait quoi, quand — horodatage systématique
- Filtrable par type d'opération, utilisateur, période

### Utilisateurs / rôles
- **Administrateur** : accès total (stock, dépenses, rapports, historique, gestion des comptes)
- **Vendeuse** : droit strict d'enregistrer une vente + mini-rapport personnel

## Règles de gestion clés

- Une vente attribuée à une vendeuse doit référencer une vendeuse active
- Le stock ne peut pas devenir négatif (blocage/alerte si vente dépasse le stock disponible)
- Toute opération est horodatée et associée à l'utilisateur connecté, sans exception
- Le bénéfice d'une vente = prix de vente figé à cette vente − coût figé (valorisé
  via FIFO/CMP au moment précis de la vente) ; jamais recalculé après coup

---

## Architecture cible en PRODUCTION (déploiement final chez le client)

⚠️ Important : ce que je décris ici est l'environnement **final**, pas l'environnement
de développement (voir section suivante).

- Machine cliente : **Windows**
- Base de données : **PostgreSQL installé nativement** sur la machine Windows
  (pas de conteneur), tournant en arrière-plan
- Backend : **Node.js (Express)**, installé comme **service Windows**
  (via NSSM ou node-windows), démarrage automatique et invisible à chaque
  allumage de la machine
- Frontend : **PWA en Vue.js**, installable sur le bureau comme une application
  autonome (icône, fenêtre sans barre d'adresse)
- **Aucun Docker en production.** Le client doit pouvoir allumer sa machine et
  cliquer sur une icône, sans rien configurer, sans terminal, sans conteneur à gérer
- Fonctionnement 100% local, sans connexion internet requise

## Environnement de DÉVELOPPEMENT (différent de la prod !)

Le développement se fait sur une machine **Ubuntu**, qui n'a pas de PostgreSQL
installé nativement. Pour ne pas polluer cette machine de dev avec une installation
native de Postgres (qui sert à plusieurs autres projets), on utilise **un conteneur
Docker uniquement pour le développement**, pour faire tourner PostgreSQL localement
pendant qu'on code.

**Ce choix Docker est un choix de confort de dev, pas une décision d'architecture
produit.** Le code applicatif ne doit avoir aucune dépendance à Docker : Docker
sert juste à simuler ici, en dev, le PostgreSQL natif qu'on installera plus tard
en dur sur la machine du client.

### Instructions importantes pour la mise en place du conteneur de dev

1. **Vérifier avant de créer.** Avant de lancer un nouveau conteneur, vérifie les
   conteneurs déjà existants sur la machine (`docker ps -a`) pour voir s'il y en a
   déjà un réutilisable pour ce projet, et éviter les doublons inutiles.

2. **Analyser très attentivement les ports avant de choisir.** Cette machine de dev
   fait tourner **beaucoup d'autres projets en parallèle**, qui occupent déjà de
   nombreux ports. Avant de choisir un port pour le conteneur PostgreSQL (ou pour
   le backend/frontend en dev) :
   - Liste les conteneurs et ports déjà utilisés (`docker ps`, et `ss -tulpn` ou
     `netstat -tulpn` pour les process hors Docker)
   - Choisis un port clairement libre, et documente-le explicitement dans le
     `docker-compose.yml` / README du projet
   - Ne jamais réutiliser un port déjà occupé par un autre projet en cours

3. **Nommer explicitement** le conteneur et le volume associé
   (ex: `parfumerie-machibel-postgres-dev`, `parfumerie-machibel-pgdata-dev`)
   pour ne jamais les confondre avec ceux d'un autre projet sur la même machine.

4. **Documenter clairement** dans le projet que ce conteneur ne sert QU'AU
   développement local — qu'en production finale, PostgreSQL tournera nativement
   sur la machine du client, sans conteneur.
