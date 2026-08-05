-- Garde-fous manquants sur les produits.
--
-- facteur_conversion valait par defaut 1 mais rien n'empechait de le mettre a 0
-- ou a une valeur negative. entreeStock divise le cout d'achat par
-- (quantite x facteur_conversion) : a zero, le cout unitaire devenait Infinity,
-- que PostgreSQL rejetait ensuite avec un "numeric field overflow" opaque.
--
-- Les valeurs deja en base sont corrigees avant la pose des contraintes, sinon
-- la migration echouerait sur une base existante.

UPDATE produits SET facteur_conversion = 1 WHERE facteur_conversion IS NULL OR facteur_conversion <= 0;
UPDATE produits SET seuil_alerte = 0 WHERE seuil_alerte < 0;
UPDATE produits SET quantite_stock = 0 WHERE quantite_stock < 0;

ALTER TABLE produits ADD CONSTRAINT produits_facteur_conversion_check CHECK (facteur_conversion > 0);
ALTER TABLE produits ADD CONSTRAINT produits_seuil_alerte_check CHECK (seuil_alerte >= 0);

-- Regle stricte du brief : le stock ne devient jamais negatif. C'etait garanti
-- par le code seulement ; la base le garantit maintenant aussi.
ALTER TABLE produits ADD CONSTRAINT produits_quantite_stock_check CHECK (quantite_stock >= 0);

-- Un lot ne peut pas contenir plus que ce qui y est entre, ni moins que rien.
UPDATE lots_stock SET quantite_restante = 0 WHERE quantite_restante < 0;
ALTER TABLE lots_stock ADD CONSTRAINT lots_stock_quantite_restante_check
  CHECK (quantite_restante >= 0 AND quantite_restante <= quantite_initiale);
