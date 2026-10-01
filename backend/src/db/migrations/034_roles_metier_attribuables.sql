-- Les roles sont attribuables depuis la table `roles`, sans enum figee. Les
-- entreprises deja creees recoivent d'abord les roles systeme : cela repare
-- les comptes admin historiques avant l'ajout de la cle etrangere.
INSERT INTO roles (entreprise_id, code, nom, systeme, super_admin)
SELECT e.id, x.code, x.nom, true, x.super_admin
  FROM entreprises e
 CROSS JOIN (VALUES
  ('admin', 'Administrateur', true),
  ('vendeuse', 'Vendeuse', false),
  ('comptabilite', 'Comptabilite', false),
  ('gestionnaire_stock', 'Gestionnaire de stock', false),
  ('direction', 'Direction', false),
  ('manager', 'Manager / Responsable', false),
  ('secretaire', 'Secretaire', false),
  ('responsable_commercial', 'Responsable commercial', false),
  ('commercial', 'Commercial', false),
  ('caissier', 'Caissier', false),
  ('magasinier', 'Magasinier', false),
  ('responsable_rh', 'Responsable RH', false),
  ('employe', 'Employe', false),
  ('support', 'Support', false),
  ('client', 'Client', false),
  ('fournisseur', 'Fournisseur', false)
 ) AS x(code, nom, super_admin)
ON CONFLICT (entreprise_id, code) DO NOTHING;

ALTER TABLE utilisateurs DROP CONSTRAINT utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_non_vide CHECK (length(trim(role)) > 0);
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_entreprise_fk
  FOREIGN KEY (entreprise_id, role) REFERENCES roles(entreprise_id, code);

WITH droits(role_code, module, action, perimetre) AS (
  VALUES
    ('direction', 'produits', 'voir', 'company'),
    ('direction', 'stock', 'voir', 'company'),
    ('direction', 'stock_mouvements', 'voir', 'company'),
    ('direction', 'ventes', 'voir', 'company'),
    ('direction', 'fournisseurs', 'voir', 'company'),
    ('direction', 'depenses', 'voir', 'company'),
    ('direction', 'paie', 'voir', 'company'),
    ('direction', 'rapports', 'voir', 'company'),
    ('direction', 'rapports', 'exporter', 'company'),
    ('manager', 'produits', 'voir', 'department'),
    ('manager', 'stock', 'voir', 'department'),
    ('manager', 'ventes', 'voir', 'team'),
    ('commercial', 'produits', 'voir', 'company'),
    ('responsable_commercial', 'produits', 'voir', 'company'),
    ('responsable_commercial', 'ventes', 'voir', 'team'),
    ('caissier', 'produits', 'voir', 'company'),
    ('caissier', 'stock', 'voir', 'branch'),
    ('caissier', 'ventes', 'creer', 'own'),
    ('magasinier', 'produits', 'voir', 'branch'),
    ('magasinier', 'stock', 'voir', 'branch')
)
INSERT INTO role_permissions (role_id, permission_id, perimetre)
SELECT r.id, p.id, d.perimetre
  FROM droits d
  JOIN roles r ON r.entreprise_id = 1 AND r.code = d.role_code
  JOIN permissions p ON p.module = d.module AND p.action = d.action
ON CONFLICT (role_id, permission_id) DO NOTHING;
