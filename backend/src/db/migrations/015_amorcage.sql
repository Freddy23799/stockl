-- Trace des amorcages de donnees joues sur cette base.
--
-- Le remplissage de demonstration ne doit s'executer qu'une seule fois, et
-- jamais sur une base qui porte deja du travail reel. Il faut donc s'en
-- souvenir quelque part, et le seul endroit fiable est la base elle-meme : le
-- disque de l'hebergeur est remis a zero a chaque redeploiement, un fichier
-- temoin y serait perdu et le remplissage recommencerait indefiniment.
--
-- `etat` distingue deux issues definitives :
--   applique  le jeu de demonstration a ete pose ;
--   ignore    la base contenait deja des donnees, on n'y a pas touche.
-- Dans les deux cas la ligne existe, donc le remplissage ne sera plus tente.
--
-- `resume` conserve le bilan chiffre et la correspondance entre les fichiers
-- deposes dans uploads/ et les images du lot versionne : c'est ce qui permet
-- de reconstituer les photos apres un redemarrage sur un hebergeur dont le
-- disque n'est pas persistant.
CREATE TABLE IF NOT EXISTS amorcages (
  nom         VARCHAR(64) PRIMARY KEY,
  etat        VARCHAR(16) NOT NULL CHECK (etat IN ('applique', 'ignore')),
  applique_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  resume      JSONB
);
