-- Compte "operateur plateforme".
--
-- Jusqu'ici, tout compte de connexion appartenait implicitement a MACHIBEL, la
-- seule entreprise existante. Avec la generalisation multi-entreprise, il faut
-- distinguer deux natures de compte :
--
--   - un compte d'ENTREPRISE (admin, vendeuse, comptabilite,
--     gestionnaire_stock) : rattache a une entreprise precise, ne voit et ne
--     gere que son perimetre ;
--   - un compte OPERATEUR : celui de l'exploitant de la plateforme SaaS
--     elle-meme. Il ne gere aucune boutique, il cree/active/desactive les
--     entreprises clientes. Volontairement separe de l'admin de MACHIBEL :
--     l'admin d'une entreprise cliente n'a aucune raison de voir ou gerer les
--     comptes d'une autre.
--
-- La coherence est posee comme contrainte de base, pas seulement de code :
-- un operateur n'a jamais d'entreprise, un compte d'entreprise en a toujours
-- une.

ALTER TABLE utilisateurs DROP CONSTRAINT utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
  CHECK (role IN ('admin', 'vendeuse', 'comptabilite', 'gestionnaire_stock', 'operateur'));

ALTER TABLE utilisateurs ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE utilisateurs SET entreprise_id = 1 WHERE role <> 'operateur';

ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_entreprise_coherente
  CHECK ((role = 'operateur' AND entreprise_id IS NULL) OR (role <> 'operateur' AND entreprise_id IS NOT NULL));

CREATE INDEX idx_utilisateurs_entreprise ON utilisateurs(entreprise_id);

-- L'identifiant de connexion n'a de sens qu'a l'interieur d'une entreprise
-- (ou, pour un operateur, parmi les operateurs) : deux entreprises distinctes
-- doivent pouvoir generer chacune un compte "jean.dupont" sans collision.
DROP INDEX idx_utilisateurs_nom_utilisateur;
CREATE UNIQUE INDEX idx_utilisateurs_nom_utilisateur
  ON utilisateurs(entreprise_id, nom_utilisateur) WHERE entreprise_id IS NOT NULL;
CREATE UNIQUE INDEX idx_utilisateurs_nom_utilisateur_operateur
  ON utilisateurs(nom_utilisateur) WHERE entreprise_id IS NULL;
