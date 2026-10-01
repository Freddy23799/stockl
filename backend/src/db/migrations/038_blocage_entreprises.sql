-- Un blocage plateforme est une decision admin explicite, avec motif et auteur.
ALTER TABLE entreprises ADD COLUMN bloquee_le TIMESTAMPTZ;
ALTER TABLE entreprises ADD COLUMN bloquee_par_id INTEGER REFERENCES utilisateurs(id);
ALTER TABLE entreprises ADD COLUMN motif_blocage TEXT;
