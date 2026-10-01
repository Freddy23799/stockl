const pool = require('../config/db');
const { logAudit } = require('../db/audit');

function clientPublic(c) {
  return { id: c.id, code: c.code, nom: c.nom, telephone: c.telephone, email: c.email, adresse: c.adresse, type: c.type, actif: c.actif, created_at: c.created_at, updated_at: c.updated_at };
}

async function prochainCode(client, entrepriseId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0) + 1 AS numero
       FROM clients WHERE entreprise_id = $1`, [entrepriseId]
  );
  return `CL-${String(rows[0].numero).padStart(5, '0')}`;
}

async function list(req, res) {
  const params = [req.user.entrepriseId];
  const conditions = ['entreprise_id = $1'];
  if (req.query.includeInactifs !== 'true') conditions.push('actif = true');
  if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); conditions.push(`(nom ILIKE $${params.length} OR code ILIKE $${params.length} OR telephone ILIKE $${params.length} OR email ILIKE $${params.length})`); }
  const { rows } = await pool.query(`SELECT * FROM clients WHERE ${conditions.join(' AND ')} ORDER BY nom LIMIT 500`, params);
  res.json(rows.map(clientPublic));
}

async function getById(req, res) {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
  if (!rows.length) return res.status(404).json({ message: 'Client introuvable' });
  res.json(clientPublic(rows[0]));
}

async function create(req, res) {
  const { nom, telephone, email, adresse, type } = req.body;
  if (!nom || !String(nom).trim()) return res.status(400).json({ message: 'Le nom du client est requis' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const code = await prochainCode(client, req.user.entrepriseId);
    const { rows } = await client.query(
      `INSERT INTO clients (entreprise_id, code, nom, telephone, email, adresse, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.entrepriseId, code, String(nom).trim(), telephone || null, email || null, adresse || null, type === 'entreprise' ? 'entreprise' : 'particulier']
    );
    await logAudit(client, { typeOperation: 'client_creation', entiteId: rows[0].id, utilisateurId: req.user.id, entrepriseId: req.user.entrepriseId, details: { client_nom: rows[0].nom, client_code: code }, apres: clientPublic(rows[0]) });
    await client.query('COMMIT');
    res.status(201).json(clientPublic(rows[0]));
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function update(req, res) {
  const { nom, telephone, email, adresse, type } = req.body;
  const { rows } = await pool.query(
    `UPDATE clients SET nom = COALESCE($1, nom), telephone = $2, email = $3, adresse = $4,
       type = COALESCE($5, type), updated_at = now() WHERE id = $6 AND entreprise_id = $7 RETURNING *`,
    [nom?.trim(), telephone || null, email || null, adresse || null, type, req.params.id, req.user.entrepriseId]
  );
  if (!rows.length) return res.status(404).json({ message: 'Client introuvable' });
  await logAudit(pool, { typeOperation: 'client_modification', entiteId: rows[0].id, utilisateurId: req.user.id, entrepriseId: req.user.entrepriseId, details: { client_nom: rows[0].nom }, apres: clientPublic(rows[0]) });
  res.json(clientPublic(rows[0]));
}

async function desactiver(req, res) {
  const { rows } = await pool.query('UPDATE clients SET actif = false, updated_at = now() WHERE id = $1 AND entreprise_id = $2 RETURNING *', [req.params.id, req.user.entrepriseId]);
  if (!rows.length) return res.status(404).json({ message: 'Client introuvable' });
  await logAudit(pool, { typeOperation: 'client_archivage', entiteId: rows[0].id, utilisateurId: req.user.id, entrepriseId: req.user.entrepriseId, details: { client_nom: rows[0].nom } });
  res.json(clientPublic(rows[0]));
}

module.exports = { list, getById, create, update, desactiver };
