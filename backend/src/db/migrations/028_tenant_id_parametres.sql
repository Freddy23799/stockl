-- entreprise_id sur parametres.
--
-- Volontairement PARTIEL par rapport aux autres tables de ce jalon : plus de
-- 15 requetes, reparties sur une dizaine de fichiers (controleurs, services,
-- middleware de modules), lisent aujourd'hui `parametres` avec un
-- `WHERE id = 1` code en dur. Les faire pointer vers l'entreprise du
-- utilisateur connecte suppose de connaitre cette entreprise a chaque requete
-- HTTP, ce qui n'existe pas encore : le jeton JWT ne porte que { id, role }
-- jusqu'a la bascule RBAC (jalon suivant).
--
-- Cette migration se contente donc de poser la colonne (nullable -> backfill
-- sur l'entreprise 1 -> NOT NULL -> unique, une ligne de parametres par
-- entreprise). La contrainte `parametres_single_row` n'est PAS retiree ici :
-- tant qu'aucun code ne sait inserer une deuxieme ligne, la retirer
-- n'apporterait rien et laisserait la table dans un etat incoherent avec le
-- reste du code, qui continue de lire `id = 1`. Son retrait, le remplacement
-- des colonnes module_* par une table extensible, et la bascule de toutes ces
-- requetes vers `entreprise_id` sont faits ensemble dans la migration RBAC
-- suivante, au moment ou le contexte d'entreprise devient disponible sur
-- chaque requete.

ALTER TABLE parametres ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
UPDATE parametres SET entreprise_id = 1 WHERE id = 1;
ALTER TABLE parametres ALTER COLUMN entreprise_id SET NOT NULL;
ALTER TABLE parametres ADD CONSTRAINT parametres_entreprise_unique UNIQUE (entreprise_id);
