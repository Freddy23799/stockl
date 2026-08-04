-- Schema initial MACHIBEL
-- Ordre des tables : produits doit exister avant stock/ventes (regle du brief).

CREATE TABLE utilisateurs (
  id            SERIAL PRIMARY KEY,
  nom           VARCHAR(150) NOT NULL,
  email         VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'vendeuse')),
  actif         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fiche vendeuse : existe independamment d'un compte de connexion
CREATE TABLE vendeuses (
  id            SERIAL PRIMARY KEY,
  nom           VARCHAR(150) NOT NULL,
  contact       VARCHAR(150),
  actif         BOOLEAN NOT NULL DEFAULT true,
  utilisateur_id INTEGER REFERENCES utilisateurs(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catalogue produits : en amont de tout le reste (stock, ventes)
CREATE TABLE produits (
  id                  SERIAL PRIMARY KEY,
  nom                 VARCHAR(200) NOT NULL,
  prix_vente          NUMERIC(12,2) NOT NULL CHECK (prix_vente >= 0),
  unite_stock         VARCHAR(30) NOT NULL,          -- unite de reference interne (piece, mL, g...)
  unite_achat         VARCHAR(30),                    -- unite d'achat, si differente (carton, bidon, kg...)
  facteur_conversion  NUMERIC(12,4) NOT NULL DEFAULT 1, -- 1 unite_achat = facteur_conversion x unite_stock
  seuil_alerte        NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantite_stock      NUMERIC(12,2) NOT NULL DEFAULT 0,
  cout_moyen_pondere  NUMERIC(12,4) NOT NULL DEFAULT 0, -- utilise si methode de valorisation = CMP
  photo               VARCHAR(255),                    -- chemin du fichier dans uploads/produits/, jamais de BLOB
  actif               BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historisation des prix : chaque changement de prix de vente est trace
CREATE TABLE historique_prix (
  id           SERIAL PRIMARY KEY,
  produit_id   INTEGER NOT NULL REFERENCES produits(id),
  ancien_prix  NUMERIC(12,2) NOT NULL,
  nouveau_prix NUMERIC(12,2) NOT NULL,
  auteur_id    INTEGER REFERENCES utilisateurs(id),
  date         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lots de stock (FIFO) : chaque entree de stock cree un lot avec son cout d'acquisition
CREATE TABLE lots_stock (
  id                 SERIAL PRIMARY KEY,
  produit_id         INTEGER NOT NULL REFERENCES produits(id),
  quantite_initiale  NUMERIC(12,2) NOT NULL,
  quantite_restante  NUMERIC(12,2) NOT NULL,
  cout_unitaire      NUMERIC(12,4) NOT NULL, -- cout par unite de reference (apres conversion)
  date_entree        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mouvements de stock (audit des entrees/sorties)
CREATE TABLE mouvements_stock (
  id             SERIAL PRIMARY KEY,
  produit_id     INTEGER NOT NULL REFERENCES produits(id),
  type           VARCHAR(10) NOT NULL CHECK (type IN ('entree', 'sortie')),
  quantite       NUMERIC(12,2) NOT NULL,
  cout_unitaire  NUMERIC(12,4), -- renseigne pour les entrees (prix d'achat converti)
  vente_id       INTEGER,       -- renseigne pour les sorties liees a une vente (FK ajoutee apres creation de ventes)
  auteur_id      INTEGER REFERENCES utilisateurs(id),
  date           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ventes : directe (boutique) ou attribuee a une vendeuse active
CREATE TABLE ventes (
  id            SERIAL PRIMARY KEY,
  type          VARCHAR(10) NOT NULL CHECK (type IN ('directe', 'vendeuse')),
  vendeuse_id   INTEGER REFERENCES vendeuses(id),
  montant_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  auteur_id     INTEGER REFERENCES utilisateurs(id),
  date          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type = 'directe' OR vendeuse_id IS NOT NULL)
);

ALTER TABLE mouvements_stock
  ADD CONSTRAINT fk_mouvements_stock_vente FOREIGN KEY (vente_id) REFERENCES ventes(id);

-- Lignes de vente : chaque ligne fige (snapshot) le prix de vente ET le cout d'acquisition
-- au moment precis de la vente. Jamais recalcule apres coup.
CREATE TABLE ventes_lignes (
  id                        SERIAL PRIMARY KEY,
  vente_id                  INTEGER NOT NULL REFERENCES ventes(id),
  produit_id                INTEGER NOT NULL REFERENCES produits(id),
  quantite                  NUMERIC(12,2) NOT NULL CHECK (quantite > 0),
  prix_vente_snapshot       NUMERIC(12,2) NOT NULL,
  cout_acquisition_snapshot NUMERIC(12,4) NOT NULL
);

CREATE TABLE depenses (
  id         SERIAL PRIMARY KEY,
  categorie  VARCHAR(100) NOT NULL,
  montant    NUMERIC(12,2) NOT NULL CHECK (montant >= 0),
  note       TEXT,
  auteur_id  INTEGER REFERENCES utilisateurs(id),
  date       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parametres : une seule ligne globale (configuration plateforme)
CREATE TABLE parametres (
  id                    SMALLINT PRIMARY KEY DEFAULT 1,
  methode_valorisation  VARCHAR(10) NOT NULL DEFAULT 'CMP' CHECK (methode_valorisation IN ('FIFO', 'CMP')),
  logo_path             VARCHAR(255) DEFAULT 'uploads/logo/logo-machibel-default.png',
  CONSTRAINT parametres_single_row CHECK (id = 1)
);
INSERT INTO parametres (id) VALUES (1);

-- Historique / audit : toute operation, horodatee et associee a l'utilisateur connecte
CREATE TABLE historique_audit (
  id               SERIAL PRIMARY KEY,
  type_operation   VARCHAR(50) NOT NULL, -- ex: 'vente', 'entree_stock', 'sortie_stock', 'depense', 'produit', ...
  entite_id        INTEGER,
  utilisateur_id   INTEGER REFERENCES utilisateurs(id),
  details          JSONB,
  date             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_produits_actif ON produits(actif);
CREATE INDEX idx_ventes_date ON ventes(date);
CREATE INDEX idx_ventes_vendeuse ON ventes(vendeuse_id);
CREATE INDEX idx_mouvements_stock_produit ON mouvements_stock(produit_id);
CREATE INDEX idx_lots_stock_produit ON lots_stock(produit_id, date_entree);
CREATE INDEX idx_historique_audit_type_date ON historique_audit(type_operation, date);
CREATE INDEX idx_historique_audit_utilisateur ON historique_audit(utilisateur_id);
