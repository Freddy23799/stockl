const pool = require('../config/db');
const { getPagination } = require('../utils/pagination');

// Etat de lecture partage (voir migration 021) : marquer une notification
// comme lue la marque lue pour tous les comptes qui la voient.

async function list(req, res) {
  const { lu } = req.query;
  const conditions = [];
  const params = [];
  if (lu === 'true' || lu === 'false') {
    params.push(lu === 'true');
    conditions.push(`n.lu = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { page, pageSize, offset } = getPagination(req, { defaultSize: 20 });

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM notifications n ${where}`, params);
  const { rows } = await pool.query(
    `SELECT n.*, p.nom AS produit_nom
     FROM notifications n LEFT JOIN produits p ON p.id = n.produit_id
     ${where} ORDER BY n.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );
  res.json({ data: rows, total: countRows[0].total, page, pageSize });
}

async function compteNonLues(req, res) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM notifications WHERE lu = false');
  res.json({ total: rows[0].total });
}

async function marquerLue(req, res) {
  const { rows } = await pool.query(
    `UPDATE notifications SET lu = true, lu_par = $1, lu_le = now()
     WHERE id = $2 RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ message: 'Notification introuvable' });
  res.json(rows[0]);
}

async function marquerToutLu(req, res) {
  await pool.query(
    `UPDATE notifications SET lu = true, lu_par = $1, lu_le = now() WHERE lu = false`,
    [req.user.id]
  );
  res.json({ message: 'Notifications marquees comme lues' });
}

module.exports = { list, compteNonLues, marquerLue, marquerToutLu };
