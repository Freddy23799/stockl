-- Notifications de stock bas.
--
-- L'ecran d'alertes existait deja (produits sous leur seuil, consultable a la
-- demande), mais rien ne signalait activement le franchissement du seuil au
-- moment ou il se produit. Cette table capture l'evenement lui-meme : une
-- ligne par franchissement, pas un etat recalcule a chaque affichage.
--
-- Etat de lecture PARTAGE (comme le reste de l'application, qui n'a pas de
-- notion de compte par utilisateur pour ses reglages) : marquer une
-- notification comme lue la marque lue pour tous les comptes qui la voient,
-- pas seulement pour celui qui a clique.
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  type        VARCHAR(30) NOT NULL,             -- 'stock_bas' pour l'instant, extensible
  produit_id  INTEGER REFERENCES produits(id),
  titre       VARCHAR(200) NOT NULL,
  message     VARCHAR(500) NOT NULL,
  lu          BOOLEAN NOT NULL DEFAULT false,
  lu_par      INTEGER REFERENCES utilisateurs(id),
  lu_le       TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_lu ON notifications(lu, created_at DESC);
