-- entreprise_id sur le journal d'audit.
--
-- Omis par erreur du decoupage initial de la generalisation multi-entreprise :
-- historique_audit est pourtant la table la plus sensible a isoler, puisque
-- c'est elle qui, plus tard (isolation stricte par Row-Level Security), doit
-- garantir qu'un administrateur d'une entreprise ne voit jamais le journal
-- d'une autre. Meme motif que 024/025/026.

ALTER TABLE historique_audit ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE historique_audit SET entreprise_id = 1;
ALTER TABLE historique_audit ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_historique_audit_entreprise ON historique_audit(entreprise_id);
