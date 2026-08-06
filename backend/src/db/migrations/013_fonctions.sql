-- Fonctions : une table de reference, plus un champ de saisie libre.
--
-- Tant que la fonction etait du texte, "Vendeuse", "vendeuse" et "Vendeuse "
-- comptaient pour trois metiers differents. Les regroupements par fonction, les
-- filtres et les statistiques devenaient faux sans que rien ne le signale.
--
-- Point d'attention : la periode de carriere GARDE le libelle en clair a cote
-- de la reference. Ce n'est pas une redondance oubliee. Un bulletin de paie
-- edite il y a trois ans doit continuer d'afficher le titre exact porte a
-- l'epoque ; si l'on rebaptisait "Vendeuse" en "Conseillere de vente", une
-- simple jointure reecrirait tout l'historique. La reference sert a l'integrite
-- (impossible de supprimer une fonction employee), le libelle a la memoire.

CREATE TABLE fonctions (
  id          SERIAL PRIMARY KEY,
  nom         VARCHAR(120) NOT NULL,
  description VARCHAR(300),
  actif       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unicite insensible a la casse et aux espaces de bord : sans cela, "Vendeuse"
-- et "vendeuse " cohabiteraient et le probleme resterait entier.
CREATE UNIQUE INDEX idx_fonctions_nom ON fonctions (lower(trim(nom)));
CREATE INDEX idx_fonctions_actif ON fonctions (actif, nom);

-- Reprise des fonctions deja saisies, dedupliquees sur la forme normalisee.
INSERT INTO fonctions (nom)
SELECT DISTINCT ON (lower(trim(fonction))) trim(fonction)
  FROM employes_carriere
 WHERE fonction IS NOT NULL AND trim(fonction) <> ''
 ORDER BY lower(trim(fonction)), id;

ALTER TABLE employes_carriere ADD COLUMN fonction_id INTEGER;

UPDATE employes_carriere c
   SET fonction_id = f.id
  FROM fonctions f
 WHERE lower(trim(c.fonction)) = lower(trim(f.nom));

-- RESTRICT, et non CASCADE : supprimer une fonction encore portee par une
-- periode de carriere effacerait cette periode, donc une partie de l'historique
-- de paie. La base refuse d'elle-meme, ce qui protege meme si un futur appel
-- oubliait de verifier.
ALTER TABLE employes_carriere
  ADD CONSTRAINT fk_carriere_fonction
  FOREIGN KEY (fonction_id) REFERENCES fonctions(id) ON DELETE RESTRICT;

CREATE INDEX idx_carriere_fonction ON employes_carriere (fonction_id);
