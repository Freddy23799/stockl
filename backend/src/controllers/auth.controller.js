const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { jwtSecret } = require('../config');

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

  const token = jwt.sign(
    { id: utilisateur.id, role: utilisateur.role },
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
    },
  });
}

async function me(req, res) {
  const { rows } = await pool.query(
    'SELECT id, prenom, nom, nom_utilisateur, email, role, actif FROM utilisateurs WHERE id = $1',
    [req.user.id]
  );
  const utilisateur = rows[0];
  if (!utilisateur || !utilisateur.actif) {
    return res.status(401).json({ message: 'Compte introuvable ou desactive' });
  }
  res.json(utilisateur);
}

module.exports = { login, me };
