-- entreprise_id sur le catalogue produits.
--
-- Motif repete a l'identique sur chaque table de cette migration et des
-- suivantes (025 a 029) : colonne nullable, backfill sur l'entreprise 1
-- (MACHIBEL, seule existante a ce jour), puis NOT NULL. Rien ne change pour le
-- code applicatif dans cette migration : aucune requete existante ne filtre
-- encore sur `entreprise_id` (ce sera fait progressivement, table par table,
-- au fur et a mesure que chaque module bascule). Tant qu'une seule entreprise
-- existe, ne pas filtrer est encore sans consequence ; la colonne est posee
-- maintenant pour ne pas avoir a re-derouler une migration de fond plus tard.

ALTER TABLE produits ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE produits SET entreprise_id = 1;
ALTER TABLE produits ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_produits_entreprise ON produits(entreprise_id);

ALTER TABLE historique_prix ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE historique_prix SET entreprise_id = 1;
ALTER TABLE historique_prix ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_historique_prix_entreprise ON historique_prix(entreprise_id);

ALTER TABLE lots_stock ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE lots_stock SET entreprise_id = 1;
ALTER TABLE lots_stock ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_lots_stock_entreprise ON lots_stock(entreprise_id);

ALTER TABLE mouvements_stock ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE mouvements_stock SET entreprise_id = 1;
ALTER TABLE mouvements_stock ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_mouvements_stock_entreprise ON mouvements_stock(entreprise_id);

ALTER TABLE categories ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE categories SET entreprise_id = 1;
ALTER TABLE categories ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_categories_entreprise ON categories(entreprise_id);

ALTER TABLE marques ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE marques SET entreprise_id = 1;
ALTER TABLE marques ALTER COLUMN entreprise_id SET NOT NULL;
CREATE INDEX idx_marques_entreprise ON marques(entreprise_id);

-- L'unicite du nom de categorie/marque etait globale (une seule entreprise a
-- ce jour) ; elle doit devenir propre a chaque entreprise, sinon la deuxieme
-- entreprise cliente ne pourrait pas nommer un rayon "Parfums" si MACHIBEL l'a
-- deja fait.
DROP INDEX categories_nom_unique;
CREATE UNIQUE INDEX categories_nom_unique ON categories (entreprise_id, lower(trim(nom)));

DROP INDEX marques_nom_unique;
CREATE UNIQUE INDEX marques_nom_unique ON marques (entreprise_id, lower(trim(nom)));
