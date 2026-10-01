-- Flux commercial : devis avant engagement, puis commande client. Les prix
-- sont figes sur les lignes pour conserver l'historique commercial.
CREATE TABLE devis (
  id              SERIAL PRIMARY KEY,
  entreprise_id   INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  numero          VARCHAR(40) NOT NULL,
  client_id       INTEGER NOT NULL REFERENCES clients(id),
  commercial_id   INTEGER NOT NULL REFERENCES utilisateurs(id),
  statut          VARCHAR(20) NOT NULL DEFAULT 'brouillon'
                  CHECK (statut IN ('brouillon', 'envoye', 'accepte', 'refuse', 'expire', 'transforme')),
  date_validite   DATE,
  note            TEXT,
  montant_total   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (montant_total >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entreprise_id, numero)
);
CREATE TABLE devis_lignes (
  id                   SERIAL PRIMARY KEY,
  devis_id             INTEGER NOT NULL REFERENCES devis(id) ON DELETE CASCADE,
  produit_id           INTEGER NOT NULL REFERENCES produits(id),
  description          VARCHAR(250) NOT NULL,
  quantite             NUMERIC(12,2) NOT NULL CHECK (quantite > 0),
  prix_unitaire        NUMERIC(14,2) NOT NULL CHECK (prix_unitaire >= 0),
  remise_pourcentage   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (remise_pourcentage BETWEEN 0 AND 100),
  total_ligne          NUMERIC(14,2) NOT NULL CHECK (total_ligne >= 0)
);
CREATE INDEX idx_devis_entreprise_statut ON devis(entreprise_id, statut, created_at DESC);

CREATE TABLE commandes_clients (
  id              SERIAL PRIMARY KEY,
  entreprise_id   INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  numero          VARCHAR(40) NOT NULL,
  devis_id        INTEGER UNIQUE REFERENCES devis(id),
  client_id       INTEGER NOT NULL REFERENCES clients(id),
  commercial_id   INTEGER NOT NULL REFERENCES utilisateurs(id),
  statut          VARCHAR(20) NOT NULL DEFAULT 'brouillon'
                  CHECK (statut IN ('brouillon', 'confirmee', 'preparation', 'livree', 'annulee')),
  note            TEXT,
  montant_total   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (montant_total >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entreprise_id, numero)
);
CREATE TABLE commandes_clients_lignes (
  id                   SERIAL PRIMARY KEY,
  commande_id          INTEGER NOT NULL REFERENCES commandes_clients(id) ON DELETE CASCADE,
  produit_id           INTEGER NOT NULL REFERENCES produits(id),
  description          VARCHAR(250) NOT NULL,
  quantite             NUMERIC(12,2) NOT NULL CHECK (quantite > 0),
  prix_unitaire        NUMERIC(14,2) NOT NULL CHECK (prix_unitaire >= 0),
  remise_pourcentage   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (remise_pourcentage BETWEEN 0 AND 100),
  total_ligne          NUMERIC(14,2) NOT NULL CHECK (total_ligne >= 0)
);
CREATE INDEX idx_commandes_clients_entreprise_statut ON commandes_clients(entreprise_id, statut, created_at DESC);

INSERT INTO permissions (module, action) VALUES
 ('devis', 'voir'), ('devis', 'creer'), ('devis', 'modifier'), ('devis', 'valider'), ('devis', 'exporter'),
 ('commandes_clients', 'voir'), ('commandes_clients', 'creer'), ('commandes_clients', 'modifier'), ('commandes_clients', 'valider'), ('commandes_clients', 'exporter')
ON CONFLICT (module, action) DO NOTHING;
WITH droits(role_code, module, action, perimetre) AS (VALUES
 ('direction', 'devis', 'voir', 'company'), ('direction', 'commandes_clients', 'voir', 'company'),
 ('responsable_commercial', 'devis', 'voir', 'team'), ('responsable_commercial', 'devis', 'creer', 'team'), ('responsable_commercial', 'devis', 'modifier', 'team'), ('responsable_commercial', 'devis', 'valider', 'team'),
 ('responsable_commercial', 'commandes_clients', 'voir', 'team'), ('responsable_commercial', 'commandes_clients', 'creer', 'team'), ('responsable_commercial', 'commandes_clients', 'modifier', 'team'), ('responsable_commercial', 'commandes_clients', 'valider', 'team'),
 ('commercial', 'devis', 'voir', 'own'), ('commercial', 'devis', 'creer', 'own'), ('commercial', 'devis', 'modifier', 'own'), ('commercial', 'devis', 'valider', 'own'),
 ('commercial', 'commandes_clients', 'voir', 'own'), ('commercial', 'commandes_clients', 'creer', 'own'), ('commercial', 'commandes_clients', 'modifier', 'own')
)
INSERT INTO role_permissions (role_id, permission_id, perimetre)
SELECT r.id, p.id, d.perimetre FROM droits d JOIN roles r ON r.entreprise_id = 1 AND r.code = d.role_code JOIN permissions p ON p.module = d.module AND p.action = d.action
ON CONFLICT (role_id, permission_id) DO NOTHING;
