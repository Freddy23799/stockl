-- Referentiel clients : base des devis, commandes, factures et portail client.
CREATE TABLE clients (
  id              SERIAL PRIMARY KEY,
  entreprise_id   INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  code            VARCHAR(30) NOT NULL,
  nom             VARCHAR(180) NOT NULL,
  telephone       VARCHAR(60),
  email           VARCHAR(150),
  adresse         TEXT,
  type            VARCHAR(15) NOT NULL DEFAULT 'particulier'
                    CHECK (type IN ('particulier', 'entreprise')),
  actif           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entreprise_id, code)
);
CREATE INDEX idx_clients_entreprise_actif ON clients(entreprise_id, actif, nom);

ALTER TABLE ventes ADD COLUMN client_id INTEGER REFERENCES clients(id);

INSERT INTO permissions (module, action) VALUES
  ('clients', 'voir'), ('clients', 'creer'), ('clients', 'modifier'), ('clients', 'archiver'), ('clients', 'exporter')
ON CONFLICT (module, action) DO NOTHING;

WITH droits(role_code, action, perimetre) AS (VALUES
  ('direction', 'voir', 'company'),
  ('comptabilite', 'voir', 'company'),
  ('secretaire', 'voir', 'department'), ('secretaire', 'creer', 'department'), ('secretaire', 'modifier', 'department'),
  ('responsable_commercial', 'voir', 'team'), ('responsable_commercial', 'creer', 'team'), ('responsable_commercial', 'modifier', 'team'),
  ('commercial', 'voir', 'own'), ('commercial', 'creer', 'own'), ('commercial', 'modifier', 'own'),
  ('support', 'voir', 'own')
)
INSERT INTO role_permissions (role_id, permission_id, perimetre)
SELECT r.id, p.id, d.perimetre FROM droits d
JOIN roles r ON r.entreprise_id = 1 AND r.code = d.role_code
JOIN permissions p ON p.module = 'clients' AND p.action = d.action
ON CONFLICT (role_id, permission_id) DO NOTHING;
