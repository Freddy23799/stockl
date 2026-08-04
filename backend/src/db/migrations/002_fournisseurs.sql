-- Fournisseurs : suivi des achats par fournisseur (extension au brief initial,
-- demandee explicitement : ajout de fournisseurs, historique par fournisseur,
-- total achete par fournisseur).

CREATE TABLE fournisseurs (
  id         SERIAL PRIMARY KEY,
  nom        VARCHAR(200) NOT NULL,
  contact    VARCHAR(150),
  actif      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chaque lot de stock (achat) et son mouvement d'entree correspondant peuvent
-- etre rattaches au fournisseur qui a fourni la marchandise.
ALTER TABLE lots_stock ADD COLUMN fournisseur_id INTEGER REFERENCES fournisseurs(id);
ALTER TABLE mouvements_stock ADD COLUMN fournisseur_id INTEGER REFERENCES fournisseurs(id);

CREATE INDEX idx_lots_stock_fournisseur ON lots_stock(fournisseur_id);
CREATE INDEX idx_mouvements_stock_fournisseur ON mouvements_stock(fournisseur_id, date);
