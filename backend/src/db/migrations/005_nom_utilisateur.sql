-- Les comptes sont desormais identifies par un nom d'utilisateur genere
-- automatiquement a partir du prenom et du nom (ex: "Jean Dupont" -> jean.dupont).
-- Beaucoup plus simple a communiquer et a saisir, pour le personnel d'une
-- boutique, qu'une adresse email.
--
-- L'email devient facultatif : il n'est plus l'identifiant de connexion, il ne
-- sert qu'a joindre la personne si on veut le renseigner.

ALTER TABLE utilisateurs ADD COLUMN prenom VARCHAR(100);
ALTER TABLE utilisateurs ADD COLUMN nom_utilisateur VARCHAR(150);

-- Comptes deja crees avant cette migration : on reprend la partie locale de
-- l'email comme identifiant (admin@machibel.local -> admin).
UPDATE utilisateurs
   SET nom_utilisateur = split_part(email, '@', 1)
 WHERE nom_utilisateur IS NULL;

ALTER TABLE utilisateurs ALTER COLUMN nom_utilisateur SET NOT NULL;
ALTER TABLE utilisateurs ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX idx_utilisateurs_nom_utilisateur ON utilisateurs(nom_utilisateur);
