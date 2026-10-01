-- Fondation multi-entreprise (SaaS).
--
-- Le systeme passe d'un client unique (MACHIBEL) a une plateforme hebergeant
-- plusieurs entreprises clientes sur la meme base. Cette table est la racine
-- de toute la suite : chaque table metier qui suit dans les migrations 024 a
-- 029 rattache ses lignes a une entreprise via `entreprise_id`.
--
-- MACHIBEL devient l'entreprise n 1, avec un id fige explicitement : c'est la
-- valeur de backfill utilisee sans ambiguite par toutes les migrations
-- suivantes sur les tables existantes.

CREATE TABLE entreprises (
  id         SERIAL PRIMARY KEY,
  nom        VARCHAR(150) NOT NULL,
  slug       VARCHAR(60) NOT NULL,
  actif      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_entreprises_slug ON entreprises (lower(slug));

INSERT INTO entreprises (id, nom, slug) VALUES (1, 'MACHIBEL', 'machibel');

-- La sequence doit repartir apres l'id impose ci-dessus, sinon la prochaine
-- entreprise creee entrerait en collision avec MACHIBEL.
SELECT setval(pg_get_serial_sequence('entreprises', 'id'), 1, true);
