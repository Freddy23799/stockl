const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { jwtSecret } = require('../config');

// Garde-fou TEMPORAIRE de la generalisation multi-entreprise.
//
// L'entreprise 1 (MACHIBEL) est la seule dont les ecrans metier (produits,
// ventes, stock, rapports...) filtrent reellement par entreprise_id : le reste
// des controleurs n'a pas encore ete bascule (travail en cours, voir le plan
// d'architecture). Un compte cree pour une AUTRE entreprise existe deja en
// base (l'operateur peut la creer), mais le laisser se connecter aujourd'hui
// verrait les donnees de MACHIBEL sur tous les ecrans non encore isoles -
// une fuite entre clients, pas juste une fonctionnalite incomplete.
//
// A retirer entierement une fois tous les controleurs scoped par entreprise
// (et, mieux, remplace par l'isolation en base - Row-Level Security).
const ENTREPRISE_ISOLATION_EFFECTIVE = new Set([1]);

// Seuls les administrateurs se connectent au systeme. Les vendeuses ne sont
// pas des utilisateurs - elles sont identifiees par un code a 6 chiffres au
// moment de la vente, jamais par une session.
async function login(req, res) {
  // On se connecte avec son nom d'utilisateur (jean.dupont). `email` reste
  // accepte pour ne pas casser les clients deja deployes.
  const { identifiant, email, password } = req.body;
  const saisie = identifiant || email;
  if (!saisie || !password) {
    return res.status(400).json({ message: 'identifiant et password sont requis' });
  }

  const { rows } = await pool.query(
    'SELECT * FROM utilisateurs WHERE nom_utilisateur = $1 OR email = $1',
    [String(saisie).trim().toLowerCase()]
  );
  const utilisateur = rows[0];
  if (!utilisateur || !utilisateur.actif) {
    return res.status(401).json({ message: 'Identifiants invalides' });
  }

  const match = await bcrypt.compare(password, utilisateur.password_hash);
  if (!match) {
    return res.status(401).json({ message: 'Identifiants invalides' });
  }

  if (utilisateur.entreprise_id && !ENTREPRISE_ISOLATION_EFFECTIVE.has(utilisateur.entreprise_id)) {
    return res.status(403).json({
      message: 'Votre entreprise a bien ete creee, mais la plateforme n\'est pas encore prete '
        + 'a l\'accueillir (isolation des donnees en cours de finalisation). Reessayez plus tard.',
      code: 'ENTREPRISE_NON_ISOLEE',
    });
  }

  const token = jwt.sign(
    { id: utilisateur.id, role: utilisateur.role, entrepriseId: utilisateur.entreprise_id },
    jwtSecret,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: {
      id: utilisateur.id,
      prenom: utilisateur.prenom,
      nom: utilisateur.nom,
      nom_utilisateur: utilisateur.nom_utilisateur,
      email: utilisateur.email,
      role: utilisateur.role,
      entreprise_id: utilisateur.entreprise_id,
    },
  });
}

async function me(req, res) {
  const { rows } = await pool.query(
    'SELECT id, prenom, nom, nom_utilisateur, email, role, entreprise_id, actif FROM utilisateurs WHERE id = $1',
    [req.user.id]
  );
  const utilisateur = rows[0];
  if (!utilisateur || !utilisateur.actif) {
    return res.status(401).json({ message: 'Compte introuvable ou desactive' });
  }
  res.json(utilisateur);
}

module.exports = { login, me };
