-- Facture de vente.
--
-- Sous-option du module Ventes, et non un module a part : une facture n'a de
-- sens que la ou il y a des ventes, et l'activer separement n'aurait rien
-- voulu dire.
--
-- Une fois active, chaque vente recoit son numero a l'enregistrement. Le numero
-- est attribue EN BASE, dans la transaction de la vente, et jamais recalcule
-- ensuite : c'est ce qui garantit qu'il ne bouge plus, qu'il ne se repete pas,
-- et qu'une facture reimprimee six mois plus tard porte exactement le meme.
--
-- Format : FA-AAAA-NNNNN, la numerotation repartant a 1 chaque annee civile,
-- comme le veut l'usage comptable. Le compteur est tenu dans une table dediee
-- plutot que par un `max(numero) + 1` : sous deux ventes simultanees, le calcul
-- a la volee attribue deux fois le meme numero.

ALTER TABLE parametres
  ADD COLUMN IF NOT EXISTS module_factures BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ventes
  ADD COLUMN IF NOT EXISTS numero_facture VARCHAR(20);

-- Unicite garantie par la base et non par le code : deux caisses qui encaissent
-- a la meme seconde ne doivent en aucun cas produire le meme numero.
CREATE UNIQUE INDEX IF NOT EXISTS ventes_numero_facture_unique
  ON ventes (numero_facture) WHERE numero_facture IS NOT NULL;

CREATE TABLE IF NOT EXISTS compteurs_facture (
  annee   INTEGER PRIMARY KEY,
  dernier INTEGER NOT NULL DEFAULT 0
);
