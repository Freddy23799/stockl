const pool = require('../config/db');
const { logAudit } = require('../db/audit');

const STATUTS = ['brouillon', 'soumis', 'approuve', 'rejete', 'annule'];
function propre(a) { return { ...a, montant: a.montant === null ? null : Number(a.montant) }; }

async function list(req, res) {
  const params = [req.user.entrepriseId];
  const conditions = ['a.entreprise_id = $1'];
  if (req.query.statut && STATUTS.includes(req.query.statut)) { params.push(req.query.statut); conditions.push(`a.statut = $${params.length}`); }
  if (req.permission.perimetre === 'own') { params.push(req.user.id); conditions.push(`a.demandeur_id = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT a.*, concat_ws(' ', d.prenom, d.nom) AS demandeur_nom,
            concat_ws(' ', ap.prenom, ap.nom) AS approbateur_nom
       FROM approbations a JOIN utilisateurs d ON d.id = a.demandeur_id
       LEFT JOIN utilisateurs ap ON ap.id = a.approbateur_id
      WHERE ${conditions.join(' AND ')} ORDER BY a.created_at DESC LIMIT 300`, params
  );
  res.json(rows.map(propre));
}

async function approbateurs(req, res) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.prenom, u.nom, u.nom_utilisateur, u.role
       FROM utilisateurs u JOIN roles r ON r.entreprise_id = u.entreprise_id AND r.code = u.role
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id AND p.module = 'approbations' AND p.action = 'valider'
      WHERE u.entreprise_id = $1 AND u.actif AND (r.super_admin OR p.id IS NOT NULL)
      ORDER BY u.nom, u.prenom`, [req.user.entrepriseId]
  );
  res.json(rows);
}

async function create(req, res) {
  const { type_document: typeDocument, document_id: documentId, titre, description, montant, approbateur_id: approbateurId } = req.body;
  if (!typeDocument || !String(typeDocument).trim() || !titre || !String(titre).trim()) return res.status(400).json({ message: 'Le type de document et le titre sont requis.' });
  if (approbateurId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM utilisateurs u JOIN roles r ON r.entreprise_id = u.entreprise_id AND r.code = u.role
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id AND p.module = 'approbations' AND p.action = 'valider'
       WHERE u.id = $1 AND u.entreprise_id = $2 AND u.actif AND (r.super_admin OR p.id IS NOT NULL)`,
      [approbateurId, req.user.entrepriseId]
    );
    if (!rows.length) return res.status(400).json({ message: 'L’approbateur choisi ne peut pas valider les demandes.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO approbations (entreprise_id, type_document, document_id, titre, description, montant, demandeur_id, approbateur_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.entrepriseId, String(typeDocument).trim(), documentId || null, String(titre).trim(), description || null, montant === '' || montant === undefined ? null : montant, req.user.id, approbateurId || null]
  );
  await logAudit(pool, { typeOperation: 'approbation_creation', entiteId: rows[0].id, utilisateurId: req.user.id, entrepriseId: req.user.entrepriseId, details: { titre: rows[0].titre, type_document: rows[0].type_document }, apres: { statut: rows[0].statut, montant: rows[0].montant } });
  res.status(201).json(propre(rows[0]));
}

async function soumettre(req, res) {
  const { rows } = await pool.query(
    `UPDATE approbations SET statut = 'soumis', soumis_le = now(), updated_at = now()
     WHERE id = $1 AND entreprise_id = $2 AND demandeur_id = $3 AND statut = 'brouillon' RETURNING *`, [req.params.id, req.user.entrepriseId, req.user.id]
  );
  if (!rows.length) return res.status(409).json({ message: 'Cette demande ne peut pas etre soumise.' });
  await logAudit(pool, { typeOperation: 'approbation_soumission', entiteId: rows[0].id, utilisateurId: req.user.id, entrepriseId: req.user.entrepriseId, details: { titre: rows[0].titre } });
  res.json(propre(rows[0]));
}

function traiter(statut) { return async (req, res) => {
  if (statut === 'rejete' && !String(req.body.motif || '').trim()) return res.status(400).json({ message: 'Un motif de rejet est obligatoire.' });
  const { rows } = await pool.query(
    `UPDATE approbations SET statut = $1, traite_le = now(), motif_rejet = $2, updated_at = now()
     WHERE id = $3 AND entreprise_id = $4 AND statut = 'soumis'
       AND (approbateur_id IS NULL OR approbateur_id = $5) RETURNING *`,
    [statut, statut === 'rejete' ? String(req.body.motif).trim() : null, req.params.id, req.user.entrepriseId, req.user.id]
  );
  if (!rows.length) return res.status(409).json({ message: 'Cette demande est introuvable, deja traitee ou ne vous est pas assignee.' });
  await logAudit(pool, { typeOperation: `approbation_${statut}`, entiteId: rows[0].id, utilisateurId: req.user.id, entrepriseId: req.user.entrepriseId, details: { titre: rows[0].titre, motif: rows[0].motif_rejet } });
  res.json(propre(rows[0]));
}; }

module.exports = { list, approbateurs, create, soumettre, approuver: traiter('approuve'), rejeter: traiter('rejete') };
