-- Journal des badges et attestations de stage emis pour un employe.
--
-- Un badge et une attestation sont des documents GENERES (a partir d'un
-- gabarit et des donnees de la fiche employe), pas des fichiers deposes : ils
-- n'ont donc pas leur place dans `employes_documents`, qui suppose un fichier
-- envoye par quelqu'un. Cette table garde la trace de chaque emission
-- (qui, quand, quel numero) et, pour l'attestation, le PDF produit - pour
-- pouvoir le retelecharger a l'identique plus tard sans le regenerer.
CREATE TABLE IF NOT EXISTS stagiaires_documents (
  id                SERIAL PRIMARY KEY,
  employe_id        INTEGER NOT NULL REFERENCES employes(id),
  type              VARCHAR(15) NOT NULL CHECK (type IN ('badge', 'attestation')),
  numero            VARCHAR(30),                 -- attestation uniquement : ATT-2026-0001
  date_debut_stage  DATE,
  date_fin_stage    DATE,
  maitre_stage      VARCHAR(150),
  theme_stage       VARCHAR(255),
  mention           TEXT,
  fichier_path      VARCHAR(255),                -- PDF conserve, pour re-telechargement
  auteur_id         INTEGER REFERENCES utilisateurs(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stagiaires_documents_numero
  ON stagiaires_documents(numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stagiaires_documents_employe
  ON stagiaires_documents(employe_id, type);
