const pool = require('../config/db');
const { getPagination } = require('../utils/pagination');

async function list(req, res) {
  const { type_operation, utilisateur_id, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (type_operation) { params.push(type_operation); conditions.push(`h.type_operation = $${params.length}`); }
  if (utilisateur_id) { params.push(utilisateur_id); conditions.push(`h.utilisateur_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`h.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`h.date <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { page, pageSize, offset } = getPagination(req);

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM historique_audit h ${where}`,
    params
  );
  // `utilisateur_nom` porte desormais le nom complet (prenom + nom) : c'est ce
  // qu'attend un lecteur humain, et l'ecran l'affichait deja sous ce nom-la.
  // L'identifiant de connexion l'accompagne, seul moyen sur de distinguer deux
  // homonymes. COALESCE couvre les comptes crees avant la migration 005, qui
  // n'ont pas de prenom.
  const { rows } = await pool.query(
    `SELECT h.*,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.prenom, u.nom)), ''), u.nom_utilisateur) AS utilisateur_nom,
            u.nom_utilisateur AS utilisateur_identifiant,
            u.actif AS utilisateur_actif
     FROM historique_audit h LEFT JOIN utilisateurs u ON u.id = h.utilisateur_id
     ${where} ORDER BY h.date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );
  res.json({ data: rows, total: countRows[0].total, page, pageSize });
}

module.exports = { list };
