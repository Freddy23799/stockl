-- RBAC matriciel : permissions (module x action), roles personnalisables par
-- entreprise, matrice role x permission avec perimetre de donnees, et
-- surcharges nominatives par utilisateur.
--
-- IMPORTANT - ce que cette migration fait et ne fait PAS :
--
--   - elle pose le SCHEMA et le SEED reproduisant fidelement les autorisations
--     REELLEMENT appliquees aujourd'hui par requireRole()/requireModule() sur
--     chaque route (voir routes/*.routes.js) ;
--   - le PERIMETRE ('own' pour la vendeuse sur les ventes) reprend un filtrage
--     deja code en dur dans ventes.controller.js (vendeuseDuCompte) : ce n'est
--     pas une nouvelle regle, c'est la premiere fois qu'elle est rendue
--     explicite et consultable ;
--   - elle N'INTERROMPT PAS l'autorisation actuelle : requireRole/requireModule
--     restent la source de verite appliquee a chaque requete. Cette matrice
--     est pour l'instant DESCRIPTIVE et EDITABLE (via l'ecran Roles &
--     permissions), pas encore ENFORCEE. La bascule de l'enforcement est un
--     chantier separe, volontairement pas fait dans la meme migration qu'un
--     changement de schema : trop de surface (~15 fichiers de routes) pour un
--     seul pas sur, verifiable.

CREATE TABLE permissions (
  id     SERIAL PRIMARY KEY,
  module VARCHAR(40) NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN (
    'voir', 'creer', 'modifier', 'supprimer', 'archiver', 'valider',
    'rejeter', 'approuver', 'annuler', 'exporter', 'imprimer',
    'telecharger', 'partager'
  )),
  UNIQUE (module, action)
);

CREATE TABLE roles (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  code          VARCHAR(60) NOT NULL,
  nom           VARCHAR(100) NOT NULL,
  -- Semes a la creation de l'entreprise, non supprimables (mais leurs
  -- permissions restent modifiables) : casser leur `code` casserait le
  -- rattachement utilisateurs.role, qui continue de faire foi pour l'instant.
  systeme       BOOLEAN NOT NULL DEFAULT false,
  -- Reprend le bypass deja implicite du role 'admin' dans le code actuel
  -- (auth.hasRole cote frontend, 'admin' toujours premier dans requireRole
  -- cote backend) : un role super_admin voit tout, sans qu'il faille
  -- enumerer une ligne role_permissions par permission existante.
  super_admin   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entreprise_id, code)
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  -- Niveau de visibilite de la donnee, independant du droit d'action lui-meme.
  -- 'own' est le seul actuellement reel dans le code (vendeuse / ses ventes) ;
  -- les autres niveaux sont poses pour l'avenir (equipe, departement, agence)
  -- mais ne sont pas encore appliques par aucun controleur.
  perimetre     VARCHAR(12) NOT NULL DEFAULT 'company'
                  CHECK (perimetre IN ('own', 'team', 'department', 'branch', 'company', 'global')),
  PRIMARY KEY (role_id, permission_id)
);

-- Surcharge nominative : accorder ou retirer un droit precis a UNE personne,
-- au-dela de ce que donne son role. Rare par nature (l'essentiel se regle par
-- role) : prevu pour l'exception, pas pour la regle.
CREATE TABLE utilisateur_permissions (
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  permission_id  INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effet          VARCHAR(7) NOT NULL CHECK (effet IN ('accorde', 'refuse')),
  perimetre      VARCHAR(12) CHECK (perimetre IN ('own', 'team', 'department', 'branch', 'company', 'global')),
  auteur_id      INTEGER REFERENCES utilisateurs(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (utilisateur_id, permission_id)
);

-- ---------------------------------------------------------------- catalogue
-- Un module ici correspond a un perimetre fonctionnel de l'application, pas
-- toujours 1-pour-1 a une table : `stock_mouvements` est separe de `stock`
-- parce que consulter l'etat du stock et consulter le detail des mouvements
-- sont deux autorisations distinctes aujourd'hui (voir stock.routes.js).
INSERT INTO permissions (module, action) VALUES
  ('produits', 'voir'), ('produits', 'creer'), ('produits', 'modifier'), ('produits', 'archiver'), ('produits', 'exporter'),
  ('stock', 'voir'), ('stock', 'creer'), ('stock', 'modifier'), ('stock', 'exporter'),
  ('stock_mouvements', 'voir'), ('stock_mouvements', 'exporter'),
  ('ventes', 'voir'), ('ventes', 'creer'), ('ventes', 'exporter'),
  ('vendeuses', 'voir'), ('vendeuses', 'creer'), ('vendeuses', 'modifier'),
  ('fournisseurs', 'voir'), ('fournisseurs', 'creer'), ('fournisseurs', 'modifier'), ('fournisseurs', 'exporter'),
  ('depenses', 'voir'), ('depenses', 'creer'), ('depenses', 'exporter'),
  ('employes', 'voir'), ('employes', 'creer'), ('employes', 'modifier'), ('employes', 'archiver'), ('employes', 'exporter'),
  ('badges', 'creer'), ('badges', 'exporter'),
  ('paie', 'voir'), ('paie', 'creer'), ('paie', 'modifier'), ('paie', 'valider'), ('paie', 'exporter'),
  ('rapports', 'voir'), ('rapports', 'exporter'),
  ('historique', 'voir'), ('historique', 'exporter'),
  ('parametres', 'voir'), ('parametres', 'modifier'),
  ('utilisateurs', 'voir'), ('utilisateurs', 'creer'), ('utilisateurs', 'modifier'), ('utilisateurs', 'archiver'),
  ('notifications', 'voir'), ('notifications', 'modifier'),
  ('referentiels', 'voir'), ('referentiels', 'creer'), ('referentiels', 'modifier'), ('referentiels', 'supprimer');

-- ------------------------------------------------------------ roles MACHIBEL
-- Reprend exactement les 4 roles existants (utilisateurs.role) pour
-- l'entreprise 1. Le `code` est identique a la valeur deja stockee dans
-- utilisateurs.role : c'est ce qui permettra, plus tard, de faire le lien
-- sans renommer aucun compte existant.
INSERT INTO roles (entreprise_id, code, nom, systeme, super_admin) VALUES
  (1, 'admin', 'Administrateur', true, true),
  (1, 'vendeuse', 'Vendeuse', true, false),
  (1, 'comptabilite', 'Comptabilite', true, false),
  (1, 'gestionnaire_stock', 'Gestionnaire de stock', true, false);

-- ------------------------------------------------------- matrice MACHIBEL
-- Fidele a requireRole()/requireModule() releve route par route. L'admin
-- n'a pas besoin de lignes : `super_admin = true` ci-dessus lui donne deja
-- tout.
WITH matrice(role_code, module, action, perimetre) AS (
  VALUES
    -- Vendeuse : caisse au comptoir, rien d'autre. 'own' reprend le filtrage
    -- deja fait par ventes.controller.js (vendeuseDuCompte).
    ('vendeuse', 'produits', 'voir', 'company'),
    ('vendeuse', 'stock', 'voir', 'company'),
    ('vendeuse', 'ventes', 'voir', 'own'),
    ('vendeuse', 'ventes', 'creer', 'own'),
    ('vendeuse', 'parametres', 'voir', 'company'),
    ('vendeuse', 'referentiels', 'voir', 'company'),

    -- Comptabilite : finances, rapports, lecture du reste.
    ('comptabilite', 'produits', 'voir', 'company'),
    ('comptabilite', 'stock', 'voir', 'company'),
    ('comptabilite', 'ventes', 'voir', 'company'),
    ('comptabilite', 'ventes', 'exporter', 'company'),
    ('comptabilite', 'depenses', 'voir', 'company'),
    ('comptabilite', 'depenses', 'creer', 'company'),
    ('comptabilite', 'depenses', 'exporter', 'company'),
    ('comptabilite', 'paie', 'voir', 'company'),
    ('comptabilite', 'paie', 'exporter', 'company'),
    ('comptabilite', 'rapports', 'voir', 'company'),
    ('comptabilite', 'rapports', 'exporter', 'company'),
    ('comptabilite', 'parametres', 'voir', 'company'),
    ('comptabilite', 'referentiels', 'voir', 'company'),

    -- Gestionnaire de stock : catalogue, stock, fournisseurs, alertes.
    ('gestionnaire_stock', 'produits', 'voir', 'company'),
    ('gestionnaire_stock', 'produits', 'creer', 'company'),
    ('gestionnaire_stock', 'produits', 'modifier', 'company'),
    ('gestionnaire_stock', 'produits', 'archiver', 'company'),
    ('gestionnaire_stock', 'produits', 'exporter', 'company'),
    ('gestionnaire_stock', 'stock', 'voir', 'company'),
    ('gestionnaire_stock', 'stock', 'creer', 'company'),
    ('gestionnaire_stock', 'stock', 'modifier', 'company'),
    ('gestionnaire_stock', 'stock', 'exporter', 'company'),
    ('gestionnaire_stock', 'stock_mouvements', 'voir', 'company'),
    ('gestionnaire_stock', 'stock_mouvements', 'exporter', 'company'),
    ('gestionnaire_stock', 'fournisseurs', 'voir', 'company'),
    ('gestionnaire_stock', 'fournisseurs', 'creer', 'company'),
    ('gestionnaire_stock', 'fournisseurs', 'modifier', 'company'),
    ('gestionnaire_stock', 'fournisseurs', 'exporter', 'company'),
    ('gestionnaire_stock', 'ventes', 'voir', 'company'),
    ('gestionnaire_stock', 'notifications', 'voir', 'company'),
    ('gestionnaire_stock', 'notifications', 'modifier', 'company'),
    ('gestionnaire_stock', 'parametres', 'voir', 'company'),
    ('gestionnaire_stock', 'referentiels', 'voir', 'company')
)
INSERT INTO role_permissions (role_id, permission_id, perimetre)
SELECT r.id, p.id, m.perimetre
  FROM matrice m
  JOIN roles r ON r.entreprise_id = 1 AND r.code = m.role_code
  JOIN permissions p ON p.module = m.module AND p.action = m.action;
