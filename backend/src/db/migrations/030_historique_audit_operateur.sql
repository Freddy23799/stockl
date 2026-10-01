-- Le journal d'audit doit aussi pouvoir enregistrer les actions de
-- l'operateur plateforme (creation d'une entreprise, par exemple) : des
-- evenements reels, mais qui ne concernent aucune entreprise cliente en
-- particulier. La migration 027 avait pose `entreprise_id` en NOT NULL en ne
-- pensant qu'aux actions internes a une entreprise ; ce n'est plus vrai
-- depuis l'introduction du role 'operateur' (029).
--
-- NULL signifie donc desormais : evenement de la plateforme elle-meme, hors
-- perimetre de toute entreprise cliente.

ALTER TABLE historique_audit ALTER COLUMN entreprise_id DROP NOT NULL;
