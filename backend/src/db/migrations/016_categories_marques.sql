-- Categorie et marque des produits.
--
-- Le catalogue ne portait qu'un nom libre. Or un point de vente tient souvent
-- le meme article sous plusieurs marques - du riz Bijou, du riz Thailande, du
-- riz Celeor - et ces trois references sont trois produits distincts, avec
-- chacun leur prix et leur stock, mais un seul et meme rayon.
--
-- Sans ces deux notions, il est impossible de repondre a "combien le rayon riz
-- a-t-il rapporte ce mois-ci" ou "quelle marque se vend le mieux", et la
-- recherche oblige a deviner l'orthographe exacte du nom.
--
-- Deux axes SEPARES plutot qu'un seul, parce qu'ils ne se recoupent pas : une
-- meme marque se retrouve dans plusieurs rayons, et un rayon accueille
-- plusieurs marques. Les melanger obligerait a creer "Riz Bijou", "Huile Bijou"
-- et ainsi de suite, c'est-a-dire a reconstituer a la main le produit des deux
-- listes.
--
-- Categorie plate, sans sous-categories. Une arborescence ne se justifie qu'a
-- partir de plusieurs centaines de references ; en dessous, elle coute a la
-- saisie ce qu'elle apporte au classement. Rien n'empeche d'ajouter un
-- `parent_id` le jour ou le catalogue le demande.
--
-- Les deux tables suivent exactement le modele de `fonctions` : reference
-- fermee, unicite insensible a la casse et aux espaces, desactivation plutot
-- que suppression quand la valeur est deja employee.

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  nom         VARCHAR(120) NOT NULL,
  description TEXT,
  actif       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Riz", "riz" et "Riz " sont le meme rayon : sans cet index, ils comptent
-- pour trois et tous les regroupements deviennent faux.
CREATE UNIQUE INDEX IF NOT EXISTS categories_nom_unique
  ON categories (lower(trim(nom)));

CREATE TABLE IF NOT EXISTS marques (
  id          SERIAL PRIMARY KEY,
  nom         VARCHAR(120) NOT NULL,
  description TEXT,
  actif       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marques_nom_unique
  ON marques (lower(trim(nom)));

-- ON DELETE RESTRICT : supprimer un rayon ne doit pas vider silencieusement la
-- categorie des produits qui s'y trouvent. Le refus vient de la base, le
-- message lisible du controleur.
ALTER TABLE produits
  ADD COLUMN IF NOT EXISTS categorie_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS marque_id    INTEGER REFERENCES marques(id)    ON DELETE RESTRICT;

-- Les deux colonnes servent surtout a filtrer et a regrouper : les rapports par
-- rayon et par marque font un GROUP BY dessus sur tout le catalogue.
CREATE INDEX IF NOT EXISTS produits_categorie_idx ON produits (categorie_id);
CREATE INDEX IF NOT EXISTS produits_marque_idx    ON produits (marque_id);
