-- Un JWT est autoporteur : une fois signe, il reste valable jusqu'a son
-- expiration (12 h), meme si le compte est desactive ou si le mot de passe a
-- change entre-temps. Sur un service expose sur Internet, cette fenetre de 12 h
-- est trop longue.
--
-- Cette colonne porte la date a partir de laquelle les jetons du compte sont
-- acceptes. Tout jeton emis AVANT est refuse (voir auth.middleware.js).
-- Elle est repositionnee a chaque changement de mot de passe et a chaque
-- desactivation du compte.
--
-- Precision a la seconde : le champ `iat` d'un JWT est en secondes. Un horodatage
-- plus fin rejetterait le jeton tout juste emis lors du changement de mot de passe.

ALTER TABLE utilisateurs ADD COLUMN tokens_invalides_avant TIMESTAMPTZ;
