-- Simplification demandee : les vendeuses ne sont PAS des comptes utilisateurs.
-- Ce sont de simples fiches de reference, identifiees par un code a 6 chiffres
-- unique et permanent (genere a la creation, jamais modifie).
-- Consequence : plus de compte de connexion pour une vendeuse. Seuls les
-- administrateurs se connectent au systeme.

ALTER TABLE vendeuses DROP CONSTRAINT IF EXISTS vendeuses_utilisateur_id_fkey;
ALTER TABLE vendeuses DROP COLUMN IF EXISTS utilisateur_id;
ALTER TABLE vendeuses ADD COLUMN code CHAR(6) NOT NULL;

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check CHECK (role = 'admin');

CREATE UNIQUE INDEX idx_vendeuses_code ON vendeuses(code);
