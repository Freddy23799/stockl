const pool = require('../config/db');
const { logAudit } = require('../db/audit');
const { finaliserFichier, nettoyerAnciennesVersions } = require('../middleware/upload.middleware');

async function get(req, res) {
  const { rows } = await pool.query('SELECT * FROM parametres WHERE id = 1');
  res.json(rows[0]);
}

async function update(req, res) {
  const { methode_valorisation, logo_path, module_ventes, module_fournisseurs, module_depenses } = req.body;
  if (methode_valorisation && !['FIFO', 'CMP'].includes(methode_valorisation)) {
    return res.status(400).json({ message: 'methode_valorisation doit etre FIFO ou CMP' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE parametres SET
         methode_valorisation = COALESCE($1, methode_valorisation),
         logo_path = COALESCE($2, logo_path),
         module_ventes = COALESCE($3, module_ventes),
         module_fournisseurs = COALESCE($4, module_fournisseurs),
         module_depenses = COALESCE($5, module_depenses)
       WHERE id = 1 RETURNING *`,
      [methode_valorisation, logo_path, module_ventes, module_fournisseurs, module_depenses]
    );
    await logAudit(client, {
      typeOperation: 'parametres_modification',
      utilisateurId: req.user.id,
      details: req.body,
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

async function uploadLogo(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier recu' });

  // Le fichier n'est renomme en "logo-machibel.<ext>" qu'ici, une fois l'envoi
  // recu en entier : un envoi interrompu ne detruit jamais le logo en place.
  const relativePath = finaliserFichier(req.file, 'logo', 'logo-machibel');
  nettoyerAnciennesVersions('logo', 'logo-machibel', relativePath);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE parametres SET logo_path = $1 WHERE id = 1 RETURNING *',
      [relativePath]
    );
    await logAudit(client, {
      typeOperation: 'parametres_logo_modifie',
      utilisateurId: req.user.id,
      details: { logo_path: relativePath },
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

module.exports = { get, update, uploadLogo };
