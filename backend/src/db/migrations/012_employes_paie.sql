-- Employes, historique de carriere, documents, paie et badges.
--
-- Trois modules nouveaux, activables comme les precedents : employes, paie,
-- badges. Les vendeuses cessent d'etre des fiches autonomes pour devenir un
-- role attribue a un employe : une meme personne ne doit pas exister deux fois
-- dans le systeme.
--
-- Principe qui gouverne tout ce fichier : ce qui a ete paye ne change jamais.
-- Un bulletin edite il y a trois ans doit se rouvrir a l'identique, meme si
-- l'employe a change de fonction, de salaire ou de nom depuis. D'ou les
-- colonnes "_snapshot" : elles figent l'etat au moment de la paie plutot que de
-- le relire par jointure.

/* ------------------------------------------------------------------ modules */

ALTER TABLE parametres ADD COLUMN module_employes BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE parametres ADD COLUMN module_paie BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE parametres ADD COLUMN module_badges BOOLEAN NOT NULL DEFAULT true;

/* ----------------------------------------------------------------- employes */

CREATE TABLE employes (
  id                     SERIAL PRIMARY KEY,

  -- Deux chiffres puis trois lettres majuscules (ex. 42XKM). Genere par le
  -- systeme, jamais saisi : c'est l'identifiant porte sur le badge et repris
  -- sur chaque bulletin de paie.
  matricule              VARCHAR(5) NOT NULL,

  prenom                 VARCHAR(100) NOT NULL,
  nom                    VARCHAR(100) NOT NULL,
  sexe                   VARCHAR(10) CHECK (sexe IN ('M', 'F') OR sexe IS NULL),
  date_naissance         DATE,
  lieu_naissance         VARCHAR(150),
  nationalite            VARCHAR(100),
  situation_matrimoniale VARCHAR(30),
  nombre_enfants         SMALLINT CHECK (nombre_enfants >= 0),

  telephone              VARCHAR(60),
  telephone_2            VARCHAR(60),
  email                  VARCHAR(150),
  adresse                VARCHAR(200),
  quartier               VARCHAR(120),
  ville                  VARCHAR(100),

  -- Piece d'identite
  numero_cni             VARCHAR(60),
  cni_date_delivrance    DATE,
  cni_lieu_delivrance    VARCHAR(150),
  cni_date_expiration    DATE,

  -- Personne a prevenir : information vitale, souvent oubliee des logiciels
  urgence_nom            VARCHAR(150),
  urgence_telephone      VARCHAR(60),
  urgence_lien           VARCHAR(60),

  -- Vie professionnelle
  date_embauche          DATE NOT NULL DEFAULT CURRENT_DATE,
  date_sortie            DATE,
  motif_sortie           VARCHAR(200),
  type_contrat           VARCHAR(30),
  numero_securite_sociale VARCHAR(60),
  banque_nom             VARCHAR(120),
  banque_numero_compte   VARCHAR(60),

  photo                  VARCHAR(255),
  note                   TEXT,
  actif                  BOOLEAN NOT NULL DEFAULT true,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Une sortie anterieure a l'embauche est une faute de saisie, pas un cas metier.
  CONSTRAINT employes_dates_coherentes CHECK (date_sortie IS NULL OR date_sortie >= date_embauche),
  CONSTRAINT employes_matricule_format CHECK (matricule ~ '^[0-9]{2}[A-Z]{3}$')
);

CREATE UNIQUE INDEX idx_employes_matricule ON employes(matricule);
-- La liste par defaut n'affiche que les employes en poste, triee par nom.
CREATE INDEX idx_employes_actif_nom ON employes(actif, nom, prenom);
-- Recherche par nom, prenom, matricule ou telephone depuis un seul champ.
CREATE INDEX idx_employes_recherche ON employes
  USING gin (to_tsvector('simple', coalesce(prenom,'') || ' ' || coalesce(nom,'') || ' ' || coalesce(matricule,'')));

/* ------------------------------------------- historique salaire et fonction */

-- Le salaire et la fonction avancent ensemble : on veut pouvoir dire "de telle
-- date a telle date, il touchait tant, en tant que tel". Une seule table donc,
-- decoupee en periodes. La periode en cours est celle dont `date_fin` est NULL.
CREATE TABLE employes_carriere (
  id           SERIAL PRIMARY KEY,
  employe_id   INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  montant      NUMERIC(12,2) NOT NULL CHECK (montant >= 0),
  fonction     VARCHAR(120) NOT NULL,
  date_debut   DATE NOT NULL,
  date_fin     DATE,
  motif        VARCHAR(200),
  auteur_id    INTEGER REFERENCES utilisateurs(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT carriere_periode_coherente CHECK (date_fin IS NULL OR date_fin >= date_debut)
);

-- Un employe n'a qu'une seule periode ouverte a la fois. Sans cette contrainte,
-- deux salaires courants coexisteraient et la paie ne saurait lequel retenir.
CREATE UNIQUE INDEX idx_carriere_courante ON employes_carriere(employe_id) WHERE date_fin IS NULL;
CREATE INDEX idx_carriere_employe_debut ON employes_carriere(employe_id, date_debut DESC);

/* ---------------------------------------------------------------- documents */

-- Un document porte un nom ("Contrat de travail", "Diplomes") et regroupe
-- plusieurs fichiers : un contrat scanne page par page reste un seul document.
CREATE TABLE employes_documents (
  id          SERIAL PRIMARY KEY,
  employe_id  INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  nom         VARCHAR(150) NOT NULL,
  categorie   VARCHAR(50),
  note        TEXT,
  auteur_id   INTEGER REFERENCES utilisateurs(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_employe ON employes_documents(employe_id, created_at DESC);

CREATE TABLE employes_documents_fichiers (
  id             SERIAL PRIMARY KEY,
  document_id    INTEGER NOT NULL REFERENCES employes_documents(id) ON DELETE CASCADE,
  chemin         VARCHAR(255) NOT NULL,
  nom_original   VARCHAR(255),
  type_mime      VARCHAR(100),
  taille_octets  INTEGER,
  -- Taille avant compression : permet de montrer ce que l'optimisation a gagne
  -- et de reperer un fichier qui n'a pas pu etre reduit.
  taille_origine INTEGER,
  ordre          SMALLINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fichiers_document ON employes_documents_fichiers(document_id, ordre);

/* ----------------------------------------------------- vendeuses <-> employe */

-- Une vendeuse devient un role porte par un employe. La colonne reste
-- facultative : les fiches creees avant cette migration n'ont pas d'employe
-- rattache et doivent continuer de fonctionner.
ALTER TABLE vendeuses ADD COLUMN employe_id INTEGER REFERENCES employes(id);
CREATE UNIQUE INDEX idx_vendeuses_employe ON vendeuses(employe_id) WHERE employe_id IS NOT NULL;

/* --------------------------------------------------------------------- paie */

-- Un cycle de paie : une periode, et la liste figee des employes a payer.
CREATE TABLE paie_cycles (
  id                SERIAL PRIMARY KEY,
  -- Huit caracteres, chiffres et majuscules, sans les glyphes ambigus.
  reference         VARCHAR(8) NOT NULL,
  libelle           VARCHAR(150),
  periode_debut     DATE NOT NULL,
  periode_fin       DATE NOT NULL,

  -- Ajustement applique a tout le monde a la creation du cycle (prime de fin
  -- d'annee, retenue exceptionnelle). Ce n'est PAS un changement de salaire :
  -- il ne touche pas la carriere de l'employe et ne vaut que pour ce cycle.
  ajustement_sens   VARCHAR(15) CHECK (ajustement_sens IN ('augmentation', 'diminution') OR ajustement_sens IS NULL),
  ajustement_mode   VARCHAR(12) CHECK (ajustement_mode IN ('montant', 'pourcentage') OR ajustement_mode IS NULL),
  ajustement_valeur NUMERIC(12,2) CHECK (ajustement_valeur IS NULL OR ajustement_valeur >= 0),
  ajustement_motif  VARCHAR(200),

  statut            VARCHAR(15) NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'cloture')),
  auteur_id         INTEGER REFERENCES utilisateurs(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT paie_periode_coherente CHECK (periode_fin >= periode_debut)
);

CREATE UNIQUE INDEX idx_paie_cycles_reference ON paie_cycles(reference);
CREATE INDEX idx_paie_cycles_periode ON paie_cycles(periode_debut DESC, periode_fin DESC);

-- Une ligne = un employe dans un cycle. Tout y est fige a la creation : le nom,
-- la fonction et le salaire sont recopies, jamais relus. C'est ce qui garantit
-- qu'un bulletin rouvert dans cinq ans affiche encore ce qui a ete paye.
CREATE TABLE paie_lignes (
  id                     SERIAL PRIMARY KEY,
  cycle_id               INTEGER NOT NULL REFERENCES paie_cycles(id) ON DELETE CASCADE,
  employe_id             INTEGER NOT NULL REFERENCES employes(id),

  matricule_snapshot     VARCHAR(5) NOT NULL,
  nom_complet_snapshot   VARCHAR(200) NOT NULL,
  fonction_snapshot      VARCHAR(120),

  salaire_base           NUMERIC(12,2) NOT NULL CHECK (salaire_base >= 0),
  ajustement_general     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ajustement_particulier NUMERIC(12,2) NOT NULL DEFAULT 0,
  ajustement_motif       VARCHAR(200),

  net_a_payer            NUMERIC(12,2) NOT NULL CHECK (net_a_payer >= 0),
  -- Somme des versements, tenue a jour a chaque paiement. Denormalise a dessein :
  -- l'ecran de cycle affiche cent lignes et ne doit pas declencher cent
  -- agregations sur la table des versements.
  montant_paye           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (montant_paye >= 0),
  statut                 VARCHAR(15) NOT NULL DEFAULT 'non_paye'
                           CHECK (statut IN ('non_paye', 'partiel', 'paye')),

  CONSTRAINT paie_lignes_unicite UNIQUE (cycle_id, employe_id),
  CONSTRAINT paie_pas_de_surpaiement CHECK (montant_paye <= net_a_payer)
);

CREATE INDEX idx_paie_lignes_cycle ON paie_lignes(cycle_id, statut);
-- "Toutes les fiches de cet employe", pour l'onglet statistiques.
CREATE INDEX idx_paie_lignes_employe ON paie_lignes(employe_id);

-- Chaque versement produit un recu. Un solde en trois fois donne trois recus :
-- chacun est la preuve d'un paiement reel, a une date reelle.
CREATE TABLE paie_versements (
  id             SERIAL PRIMARY KEY,
  ligne_id       INTEGER NOT NULL REFERENCES paie_lignes(id) ON DELETE CASCADE,
  numero_recu    VARCHAR(8) NOT NULL,
  montant        NUMERIC(12,2) NOT NULL CHECK (montant > 0),
  mode_paiement  VARCHAR(30),
  note           VARCHAR(300),
  -- Solde ou simple avance : deduit du reste a payer au moment du versement,
  -- fige ici pour que le recu ne change pas de nature si un avoir survient apres.
  est_solde      BOOLEAN NOT NULL DEFAULT false,
  auteur_id      INTEGER REFERENCES utilisateurs(id),
  paye_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_versements_numero ON paie_versements(numero_recu);
CREATE INDEX idx_versements_ligne ON paie_versements(ligne_id, paye_le);
-- L'onglet "historique des recus" trie par date sur toute la base.
CREATE INDEX idx_versements_date ON paie_versements(paye_le DESC);
