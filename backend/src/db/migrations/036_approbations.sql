-- Moteur generique de validation. Les modules (achats, conges, stock,
-- depenses...) y referencent leurs documents sans recopier leur workflow.
CREATE TABLE approbations (
  id               SERIAL PRIMARY KEY,
  entreprise_id    INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  type_document    VARCHAR(60) NOT NULL,
  document_id      INTEGER,
  titre            VARCHAR(200) NOT NULL,
  description      TEXT,
  montant          NUMERIC(14,2),
  statut           VARCHAR(20) NOT NULL DEFAULT 'brouillon'
                   CHECK (statut IN ('brouillon', 'soumis', 'approuve', 'rejete', 'annule')),
  demandeur_id     INTEGER NOT NULL REFERENCES utilisateurs(id),
  approbateur_id   INTEGER REFERENCES utilisateurs(id),
  soumis_le        TIMESTAMPTZ,
  traite_le        TIMESTAMPTZ,
  motif_rejet      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((statut <> 'rejete') OR motif_rejet IS NOT NULL)
);
CREATE INDEX idx_approbations_entreprise_statut ON approbations(entreprise_id, statut, created_at DESC);
CREATE INDEX idx_approbations_approbateur ON approbations(approbateur_id, statut);

INSERT INTO permissions (module, action) VALUES
 ('approbations', 'voir'), ('approbations', 'creer'), ('approbations', 'modifier'),
 ('approbations', 'valider'), ('approbations', 'rejeter'), ('approbations', 'annuler')
ON CONFLICT (module, action) DO NOTHING;

WITH droits(role_code, action, perimetre) AS (VALUES
 ('direction', 'voir', 'company'), ('direction', 'valider', 'company'), ('direction', 'rejeter', 'company'),
 ('manager', 'voir', 'department'), ('manager', 'valider', 'department'), ('manager', 'rejeter', 'department'),
 ('gestionnaire_stock', 'voir', 'company'), ('gestionnaire_stock', 'creer', 'company'), ('gestionnaire_stock', 'modifier', 'company'),
 ('comptabilite', 'voir', 'company'), ('comptabilite', 'creer', 'company'), ('comptabilite', 'modifier', 'company'),
 ('responsable_rh', 'voir', 'department'), ('responsable_rh', 'creer', 'department'), ('responsable_rh', 'modifier', 'department'),
 ('employe', 'voir', 'own'), ('employe', 'creer', 'own'), ('employe', 'modifier', 'own')
)
INSERT INTO role_permissions (role_id, permission_id, perimetre)
SELECT r.id, p.id, d.perimetre FROM droits d
JOIN roles r ON r.entreprise_id = 1 AND r.code = d.role_code
JOIN permissions p ON p.module = 'approbations' AND p.action = d.action
ON CONFLICT (role_id, permission_id) DO NOTHING;
