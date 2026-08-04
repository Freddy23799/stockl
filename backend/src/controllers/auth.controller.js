const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Seuls les administrateurs se connectent au systeme. Les vendeuses ne sont
// pas des utilisateurs - elles sont identifiees par un code a 6 chiffres au
// moment de la vente, jamais par une session.
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'email et password sont requis' });
  }

  const { rows } = await pool.query('SELECT * FROM utilisateurs WHERE email = $1', [email]);
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
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: {
      id: utilisateur.id,
      nom: utilisateur.nom,
      email: utilisateur.email,
      role: utilisateur.role,
    },
  });
}

async function me(req, res) {
  const { rows } = await pool.query(
    'SELECT id, nom, email, role, actif FROM utilisateurs WHERE id = $1',
    [req.user.id]
  );
  const utilisateur = rows[0];
  if (!utilisateur || !utilisateur.actif) {
    return res.status(401).json({ message: 'Compte introuvable ou desactive' });
  }
  res.json(utilisateur);
}

module.exports = { login, me };
