const pool = require('../config/db');
const { logAudit } = require('../db/audit');

function genererCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Genere un code a 6 chiffres unique. Le code identifie une vendeuse de facon
// permanente - il n'est jamais reattribue ni modifie apres creation.
async function genererCodeUnique(client) {
  for (let tentative = 0; tentative < 20; tentative += 1) {
    const code = genererCode();
    const { rows } = await client.query('SELECT 1 FROM vendeuses WHERE code = $1', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Impossible de generer un code vendeuse unique');
}

async function getByCode(req, res) {
  const { rows } = await pool.query('SELECT * FROM vendeuses WHERE code = $1', [req.params.code]);
  if (rows.length === 0) return res.status(404).json({ message: 'Aucune vendeuse avec ce code' });
  res.json(rows[0]);
}

async function list(req, res) {
  const includeInactives = req.query.includeInactifs === 'true';
  const { rows } = await pool.query(
    includeInactives
      ? 'SELECT * FROM vendeuses ORDER BY nom'
      : 'SELECT * FROM vendeuses WHERE actif = true ORDER BY nom'
  );
  res.json(rows);
}

async function create(req, res) {
  const { nom, contact } = req.body;
  if (!nom) return res.status(400).json({ message: 'nom est requis' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const code = await genererCodeUnique(client);
    const { rows } = await client.query(
      'INSERT INTO vendeuses (nom, contact, code) VALUES ($1, $2, $3) RETURNING *',
      [nom, contact || null, code]
    );
    await logAudit(client, {
      typeOperation: 'vendeuse_creation',
      entiteId: rows[0].id,
      utilisateurId: req.user?.id,
      details: { vendeuse_nom: nom, code },
      apres: { nom: rows[0].nom, contact: rows[0].contact, code: rows[0].code, actif: rows[0].actif },
    });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const { id } = req.params;
  const { nom, contact } = req.body;
  const { rows } = await pool.query(
    `UPDATE vendeuses SET nom = COALESCE($1, nom), contact = COALESCE($2, contact) WHERE id = $3 RETURNING *`,
    [nom, contact, id]
  );
  if (rows.length === 0) return res.status(404).json({ message: 'Vendeuse introuvable' });
  res.json(rows[0]);
}

function setActif(actif) {
  return async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existantes } = await client.query('SELECT * FROM vendeuses WHERE id = $1 FOR UPDATE', [id]);
      if (existantes.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Vendeuse introuvable' });
      }
      const existante = existantes[0];

      const { rows } = await client.query(
        'UPDATE vendeuses SET actif = $1 WHERE id = $2 RETURNING *',
        [actif, id]
      );
      await logAudit(client, {
        typeOperation: actif ? 'vendeuse_activation' : 'vendeuse_desactivation',
        entiteId: Number(id),
        utilisateurId: req.user?.id,
        details: { vendeuse_nom: existante.nom, code: existante.code },
        avant: { actif: existante.actif },
        apres: { actif: rows[0].actif },
      });
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
}

module.exports = { list, getByCode, create, update, activer: setActif(true), desactiver: setActif(false) };
