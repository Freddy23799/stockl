-- entreprise_id sur ventes, stock complementaire, vendeuses, depenses,
-- fournisseurs, notifications. Meme motif que 024 (nullable -> backfill sur 1
-- -> NOT NULL).
--
-- Point d'attention specifique a ce fichier : plusieurs identifiants "humains"
-- generes par le systeme etaient uniques GLOBALEMENT alors qu'ils ne devraient
-- l'etre que PAR ENTREPRISE. Sans correction, la deuxieme entreprise cliente
-- ne pourrait pas emettre sa propre facture FA-2026-00001 si MACHIBEL l'a deja
-- fait, ni attribuer son propre code a 6 chiffres a une vendeuse si MACHIBEL
-- utilise deja ce code. Cette migration corrige ces contraintes en meme temps
-- que l'ajout de la colonne, plutot que de le reporter a une migration
-- separee qui devrait de toute facon refaire le meme travail.

ALTER TABLE ventes ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE ventes SET entreprise_id = 1;
ALTER TABLE ventes ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_ventes_entreprise ON ventes(entreprise_id);

-- Le numero de facture n'a de sens qu'a l'interieur d'une entreprise.
DROP INDEX ventes_numero_facture_unique;
CREATE UNIQUE INDEX ventes_numero_facture_unique
  ON ventes (entreprise_id, numero_facture) WHERE numero_facture IS NOT NULL;

ALTER TABLE ventes_lignes ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE ventes_lignes SET entreprise_id = 1;
ALTER TABLE ventes_lignes ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_ventes_lignes_entreprise ON ventes_lignes(entreprise_id);

ALTER TABLE vendeuses ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE vendeuses SET entreprise_id = 1;
ALTER TABLE vendeuses ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_vendeuses_entreprise ON vendeuses(entreprise_id);

-- Le code a 6 chiffres au comptoir n'a de sens que pour l'entreprise qui l'a
-- attribue.
DROP INDEX idx_vendeuses_code;
CREATE UNIQUE INDEX idx_vendeuses_code ON vendeuses(entreprise_id, code);

ALTER TABLE depenses ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE depenses SET entreprise_id = 1;
ALTER TABLE depenses ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_depenses_entreprise ON depenses(entreprise_id);

ALTER TABLE fournisseurs ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE fournisseurs SET entreprise_id = 1;
ALTER TABLE fournisseurs ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_fournisseurs_entreprise ON fournisseurs(entreprise_id);

ALTER TABLE notifications ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE notifications SET entreprise_id = 1;
ALTER TABLE notifications ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_notifications_entreprise ON notifications(entreprise_id);

-- Le compteur de facture devient une cle composite : sans ca, deux entreprises
-- qui facturent la meme annee civile partageraient et ecraseraient le meme
-- compteur (voir 017_facturation.sql).
ALTER TABLE compteurs_facture ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE compteurs_facture SET entreprise_id = 1;
ALTER TABLE compteurs_facture ALTER COLUMN entreprise_id SET NOT NULL;
ALTER TABLE compteurs_facture DROP CONSTRAINT compteurs_facture_pkey;
ALTER TABLE compteurs_facture ADD PRIMARY KEY (entreprise_id, annee);
