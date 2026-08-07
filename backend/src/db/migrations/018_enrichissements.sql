-- Trace des enrichissements de donnees joues sur cette base.
--
-- Les migrations font evoluer le SCHEMA ; elles ne peuvent rien pour les
-- donnees deja saisies. Quand une version ajoute une notion - le rayon et la
-- marque d'un produit, par exemple - les lignes existantes arrivent vides et
-- le rester : la fonctionnalite est en place mais ne montre rien.
--
-- Sur un poste, il suffirait de lancer un script a la main. Sur un hebergement
-- gere, il n'y a ni terminal ni acces direct a la base : le seul moment ou du
-- code tourne, c'est le demarrage du serveur. D'ou cette table, jumelle de
-- `schema_migrations` mais pour les donnees.
--
-- Une ligne ici veut dire "cet enrichissement a ete joue, ne le rejoue plus".
-- Un enrichissement qui ne s'applique pas encore n'inscrit rien et sera
-- reexamine au demarrage suivant : c'est ce qui permet a une base amorcee
-- apres coup de recevoir quand meme le traitement.
CREATE TABLE IF NOT EXISTS enrichissements (
  nom         VARCHAR(80) PRIMARY KEY,
  applique_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  resume      JSONB
);
