-- Motif de blocage d'un employe.
--
-- Bloquer quelqu'un sans dire pourquoi ne rend service a personne : six mois
-- plus tard, plus personne ne sait s'il s'agissait d'un depart, d'une suspension
-- disciplinaire ou d'un simple conge de longue duree - et donc si le compte doit
-- etre rouvert.
--
-- Le blocage porte deja partout dans le systeme : un employe inactif est exclu
-- des cycles de paie, de l'impression des badges, des listes par defaut, et son
-- code de vente est refuse en caisse. Ces colonnes ajoutent la memoire du
-- pourquoi et du quand.

ALTER TABLE employes ADD COLUMN motif_blocage VARCHAR(300);
ALTER TABLE employes ADD COLUMN bloque_le TIMESTAMPTZ;
ALTER TABLE employes ADD COLUMN bloque_par INTEGER REFERENCES utilisateurs(id);

-- Les employes deja archives avant cette migration n'ont pas de motif : on ne
-- l'invente pas, on le laisse vide et l'interface affiche "non precise".
COMMENT ON COLUMN employes.motif_blocage IS
  'Raison du blocage. Vide pour les fiches archivees avant l''ajout de cette colonne.';
