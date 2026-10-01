-- La gestion de la matrice RBAC est elle-meme une capacite sensible. Elle est
-- separee des simples parametres d'etablissement afin de ne jamais donner la
-- possibilite d'elever ses droits a un administrateur operationnel.
INSERT INTO permissions (module, action) VALUES
  ('roles', 'voir'),
  ('roles', 'creer'),
  ('roles', 'modifier')
ON CONFLICT (module, action) DO NOTHING;
