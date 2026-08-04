const pool = require('../config/db');
const { logAudit } = require('../db/audit');

async function list(req, res) {
  const { from, to, categorie } = req.query;
  const conditions = [];
  const params = [];

  if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`date <= $${params.length}`); }
  if (categorie) { params.push(categorie); conditions.push(`categorie = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM depenses ${where} ORDER BY date DESC LIMIT 500`,
    params
  );
  res.json(rows);
}

async function create(req, res) {
  const { categorie, montant, note, date } = req.body;
  if (!categorie || !(Number(montant) >= 0)) {
    return res.status(400).json({ message: 'categorie et montant (>= 0) sont requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO depenses (categorie, montant, note, auteur_id, date)
       VALUES ($1, $2, $3, $4, COALESCE($5, now())) RETURNING *`,
      [categorie, montant, note || null, req.user.id, date || null]
    );
    await logAudit(client, {
      typeOperation: 'depense_creation',
      entiteId: rows[0].id,
      utilisateurId: req.user.id,
      details: { categorie, montant },
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

module.exports = { list, create };
