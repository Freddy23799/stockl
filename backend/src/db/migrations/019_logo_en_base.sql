-- Le logo de l'etablissement, conserve dans la base et non seulement sur disque.
--
-- `logo_path` designe un fichier de `uploads/`. Sur un hebergement sans disque
-- persistant - le plan gratuit de Render, celui qui est en service - ce dossier
-- est remis a zero a chaque redemarrage, et le service se met en veille toutes
-- les quinze minutes. Un logo envoye par l'exploitant disparait donc au premier
-- reveil : la base continue de pointer vers un fichier qui n'existe plus, et
-- l'en-tete de l'application comme celui de tous les PDF se retrouve vide.
--
-- Les photos de demonstration sont reposees depuis le lot versionne du depot ;
-- le logo, lui, vient de l'exploitant et ne peut etre versionne nulle part. Le
-- seul endroit qui survit au redemarrage est la base. C'est peu couteux : une
-- image, quelques dizaines de kilo-octets, modifiee une fois par an.
--
-- La colonne `logo_path` reste la source pour tout le reste du code : le
-- fichier est simplement reecrit sur disque au demarrage a partir d'ici. Rien
-- a changer dans le service PDF ni dans le frontend.
ALTER TABLE parametres
  ADD COLUMN IF NOT EXISTS logo_donnees BYTEA,
  ADD COLUMN IF NOT EXISTS logo_type    VARCHAR(80);
