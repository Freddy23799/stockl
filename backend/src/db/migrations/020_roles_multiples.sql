-- Ouverture du systeme de comptes a des roles restreints.
--
-- La migration 003 avait volontairement ferme les comptes de connexion aux
-- seuls administrateurs ("les vendeuses ne sont PAS des comptes
-- utilisateurs"). Le besoin a change : certains acteurs (vendeuse,
-- comptabilite, gestionnaire de stock) doivent desormais pouvoir se
-- connecter eux-memes, avec des droits strictement limites a leur perimetre,
-- toujours crees par un administrateur.
--
-- Le code a 6 chiffres des vendeuses N'EST PAS retire : il reste la voie
-- rapide au comptoir. Le compte de connexion s'ajoute en plus, pour donner a
-- une vendeuse un acces personnel (son propre historique, le stock en
-- lecture) sans passer par un poste partage.

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
  CHECK (role IN ('admin', 'vendeuse', 'comptabilite', 'gestionnaire_stock'));

-- Lien optionnel entre une fiche vendeuse et un compte de connexion. Distinct
-- du code a 6 chiffres : une fiche vendeuse peut exister sans jamais avoir de
-- compte (cas normal, code seul), ou en avoir un si l'administrateur lui a
-- cree un acces personnel.
ALTER TABLE vendeuses ADD COLUMN IF NOT EXISTS compte_utilisateur_id INTEGER
  REFERENCES utilisateurs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendeuses_compte_utilisateur
  ON vendeuses(compte_utilisateur_id) WHERE compte_utilisateur_id IS NOT NULL;
