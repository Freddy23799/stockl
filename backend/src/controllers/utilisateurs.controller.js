const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { logAudit } = require('../db/audit');

async function list(req, res) {
  const { rows } = await pool.query(
    'SELECT id, nom, email, role, actif, created_at FROM utilisateurs ORDER BY nom'
  );
  res.json(rows);
}

// Seuls des comptes Administrateur existent : les vendeuses ne sont pas des
// utilisateurs, seulement des fiches de reference identifiees par un code.
async function create(req, res) {
  const { nom, email, password } = req.body;
  if (!nom || !email || !password) {
    return res.status(400).json({ message: 'nom, email et password sont requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await client.query(
      `INSERT INTO utilisateurs (nom, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, nom, email, role, actif, created_at`,
      [nom, email, passwordHash]
    );
    const utilisateur = rows[0];

    await logAudit(client, {
      typeOperation: 'utilisateur_creation',
      entiteId: utilisateur.id,
      utilisateurId: req.user?.id,
      details: { email },
    });

    await client.query('COMMIT');
    res.status(201).json(utilisateur);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Cet email est deja utilise' });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function desactiver(req, res) {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE utilisateurs SET actif = false WHERE id = $1 RETURNING id, nom, email, role, actif',
      [id]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }
    await logAudit(client, {
      typeOperation: 'utilisateur_desactivation',
      entiteId: Number(id),
      utilisateurId: req.user?.id,
    });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { list, create, desactiver };
