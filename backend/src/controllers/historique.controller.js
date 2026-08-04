const pool = require('../config/db');

async function list(req, res) {
  const { type_operation, utilisateur_id, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (type_operation) { params.push(type_operation); conditions.push(`h.type_operation = $${params.length}`); }
  if (utilisateur_id) { params.push(utilisateur_id); conditions.push(`h.utilisateur_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`h.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`h.date <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT h.*, u.nom AS utilisateur_nom
     FROM historique_audit h LEFT JOIN utilisateurs u ON u.id = h.utilisateur_id
     ${where} ORDER BY h.date DESC LIMIT 500`,
    params
  );
  res.json(rows);
}

module.exports = { list };
