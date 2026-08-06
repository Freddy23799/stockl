-- Motif d'un mouvement de stock.
--
-- Jusqu'ici le stock ne pouvait baisser que par une vente. Or une boutique perd
-- de la marchandise autrement : un flacon casse, un vol, une erreur de saisie,
-- un ecart constate en comptant les rayons. Sans moyen d'enregistrer cela, le
-- stock theorique s'eloigne du stock reel, et la seule facon de "corriger" etait
-- d'inventer une vente - ce qui faussait le chiffre d'affaires.
--
-- Le motif s'ajoute au type plutot que de le remplacer : tout ce qui compte les
-- entrees et les sorties (rapports, valorisation, controle d'integrite)
-- continue de fonctionner sans modification.

ALTER TABLE mouvements_stock ADD COLUMN motif VARCHAR(40);
ALTER TABLE mouvements_stock ADD COLUMN note TEXT;

-- Les mouvements deja enregistres recoivent leur motif d'origine, deductible
-- sans ambiguite : une sortie rattachee a une vente vient d'une vente, une
-- entree vient d'un ravitaillement.
UPDATE mouvements_stock
   SET motif = CASE
     WHEN type = 'entree' THEN 'ravitaillement'
     WHEN vente_id IS NOT NULL THEN 'vente'
     ELSE 'correction'
   END
 WHERE motif IS NULL;

ALTER TABLE mouvements_stock ALTER COLUMN motif SET NOT NULL;

-- La liste est fermee : un motif libre finirait en champ de saisie fourre-tout,
-- impossible a regrouper dans un rapport.
ALTER TABLE mouvements_stock ADD CONSTRAINT mouvements_stock_motif_valide
  CHECK (motif IN ('ravitaillement', 'vente', 'inventaire', 'perte', 'casse', 'vol', 'retour_client', 'correction'));

-- Les ecrans de stock filtrent par motif pour isoler les pertes.
CREATE INDEX idx_mouvements_stock_motif ON mouvements_stock(motif, date);
