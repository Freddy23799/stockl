-- entreprise_id sur employes, carriere, documents, paie, fonctions et
-- documents generes (badges/attestations). Meme motif que 024/025.
--
-- Meme correction d'unicite qu'en 025 : matricule employe, reference de cycle
-- de paie, numero de recu et nom de fonction etaient uniques globalement,
-- alors qu'ils sont attribues independamment par chaque entreprise.

ALTER TABLE employes ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE employes SET entreprise_id = 1;
ALTER TABLE employes ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_employes_entreprise ON employes(entreprise_id);

DROP INDEX idx_employes_matricule;
CREATE UNIQUE INDEX idx_employes_matricule ON employes(entreprise_id, matricule);

ALTER TABLE employes_carriere ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE employes_carriere SET entreprise_id = 1;
ALTER TABLE employes_carriere ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_employes_carriere_entreprise ON employes_carriere(entreprise_id);

ALTER TABLE employes_documents ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE employes_documents SET entreprise_id = 1;
ALTER TABLE employes_documents ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_employes_documents_entreprise ON employes_documents(entreprise_id);

ALTER TABLE paie_cycles ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE paie_cycles SET entreprise_id = 1;
ALTER TABLE paie_cycles ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_paie_cycles_entreprise ON paie_cycles(entreprise_id);

DROP INDEX idx_paie_cycles_reference;
CREATE UNIQUE INDEX idx_paie_cycles_reference ON paie_cycles(entreprise_id, reference);

ALTER TABLE paie_lignes ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE paie_lignes SET entreprise_id = 1;
ALTER TABLE paie_lignes ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_paie_lignes_entreprise ON paie_lignes(entreprise_id);

ALTER TABLE paie_versements ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE paie_versements SET entreprise_id = 1;
ALTER TABLE paie_versements ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_paie_versements_entreprise ON paie_versements(entreprise_id);

DROP INDEX idx_versements_numero;
CREATE UNIQUE INDEX idx_versements_numero ON paie_versements(entreprise_id, numero_recu);

ALTER TABLE fonctions ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE fonctions SET entreprise_id = 1;
ALTER TABLE fonctions ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_fonctions_entreprise ON fonctions(entreprise_id);

DROP INDEX idx_fonctions_nom;
CREATE UNIQUE INDEX idx_fonctions_nom ON fonctions (entreprise_id, lower(trim(nom)));

ALTER TABLE stagiaires_documents ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE stagiaires_documents SET entreprise_id = 1;
ALTER TABLE stagiaires_documents ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_stagiaires_documents_entreprise ON stagiaires_documents(entreprise_id);

DROP INDEX idx_stagiaires_documents_numero;
CREATE UNIQUE INDEX idx_stagiaires_documents_numero
  ON stagiaires_documents(entreprise_id, numero) WHERE numero IS NOT NULL;
