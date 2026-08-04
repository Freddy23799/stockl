-- Modules configurables par l'admin. Le "noyau" (Produits, Stock, Rapports,
-- Historique, Parametres, Comptes admin) reste toujours actif : seuls les
-- modules qui ont un sens a etre desactives independamment le sont.
-- Par defaut tout est actif, pour ne rien changer au comportement existant.

ALTER TABLE parametres ADD COLUMN module_ventes BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE parametres ADD COLUMN module_fournisseurs BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE parametres ADD COLUMN module_depenses BOOLEAN NOT NULL DEFAULT true;
