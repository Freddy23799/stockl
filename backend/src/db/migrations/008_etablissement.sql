-- Identite de l'etablissement.
--
-- Ces champs n'ont qu'un seul consommateur reel : l'entete des documents
-- imprimes. Un rapport qui sort de l'application est remis a un banquier, a un
-- comptable ou a un client - il doit porter le nom, l'adresse et les moyens de
-- contact de la structure, pas seulement des chiffres.
--
-- Tout est facultatif sauf le nom : une boutique qui n'a pas encore de site web
-- ou de registre du commerce doit pouvoir imprimer quand meme, et l'entete
-- s'adapte en masquant les lignes vides.
--
-- Une seule ligne (id = 1), comme le reste de `parametres`.

ALTER TABLE parametres ADD COLUMN etablissement_nom VARCHAR(150) NOT NULL DEFAULT 'MACHIBEL';
ALTER TABLE parametres ADD COLUMN etablissement_slogan VARCHAR(200);
ALTER TABLE parametres ADD COLUMN etablissement_activite VARCHAR(150);

-- Localisation. `adresse` porte la rue ou le quartier, `ville` et `pays` sont
-- separes parce qu'ils se composent differemment selon le document.
ALTER TABLE parametres ADD COLUMN etablissement_adresse VARCHAR(200);
ALTER TABLE parametres ADD COLUMN etablissement_quartier VARCHAR(120);
ALTER TABLE parametres ADD COLUMN etablissement_ville VARCHAR(100);
ALTER TABLE parametres ADD COLUMN etablissement_pays VARCHAR(100);
ALTER TABLE parametres ADD COLUMN etablissement_boite_postale VARCHAR(60);

-- Deux numeros : la plupart des commerces en affichent un fixe et un mobile.
ALTER TABLE parametres ADD COLUMN etablissement_telephone VARCHAR(60);
ALTER TABLE parametres ADD COLUMN etablissement_telephone_2 VARCHAR(60);
ALTER TABLE parametres ADD COLUMN etablissement_email VARCHAR(150);
ALTER TABLE parametres ADD COLUMN etablissement_site_web VARCHAR(200);

-- Identifiants legaux. Nommes de facon neutre : le libelle affiche est fourni
-- par l'interface, ce qui evite de figer ici une nomenclature nationale.
ALTER TABLE parametres ADD COLUMN etablissement_registre_commerce VARCHAR(80);
ALTER TABLE parametres ADD COLUMN etablissement_identifiant_fiscal VARCHAR(80);
ALTER TABLE parametres ADD COLUMN etablissement_capital VARCHAR(80);

-- Mention libre reprise en pied de chaque page imprimee (forme juridique,
-- clause de confidentialite, numero d'agrement...).
ALTER TABLE parametres ADD COLUMN etablissement_mention_pied TEXT;

-- La devise est deja implicite partout dans le code (le franc CFA), mais un
-- document imprime doit l'ecrire noir sur blanc.
ALTER TABLE parametres ADD COLUMN devise VARCHAR(10) NOT NULL DEFAULT 'FCFA';
