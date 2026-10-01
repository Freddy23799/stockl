-- Retrait de la contrainte "une seule ligne" sur parametres.
--
-- Posee en 001_init.sql quand une seule entreprise existait, deliberement
-- laissee en place par 028_tenant_id_parametres.sql tant qu'aucun code
-- n'inserait de deuxieme ligne. C'est desormais le cas : la creation d'une
-- entreprise (entreprises.controller.js) pose sa propre ligne de parametres.
-- L'unicite reelle a retenir est deja garantie par ailleurs :
-- `parametres_entreprise_unique` (028), une ligne par entreprise.

ALTER TABLE parametres DROP CONSTRAINT parametres_single_row;
