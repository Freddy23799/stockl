-- L'ecran Historique lit toujours la table dans le meme sens : les operations
-- les plus recentes d'abord, par pages de 20. Sans filtre de type ni
-- d'utilisateur, aucun des index existants ne sert cet ordre - PostgreSQL lit
-- la table entiere et trie, ce qui s'aggrave a chaque operation enregistree
-- alors que la requete, elle, ne ramene jamais que 20 lignes.

CREATE INDEX IF NOT EXISTS idx_historique_audit_date ON historique_audit(date DESC);
