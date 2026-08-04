const pool = require('../config/db');
const { logAudit } = require('../db/audit');

async function list(req, res) {
  const includeInactifs = req.query.includeInactifs === 'true';
  const { rows } = await pool.query(
    includeInactifs
      ? 'SELECT * FROM produits ORDER BY nom'
      : 'SELECT * FROM produits WHERE actif = true ORDER BY nom'
  );
  res.json(rows);
}

async function getById(req, res) {
  const { rows } = await pool.query('SELECT * FROM produits WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ message: 'Produit introuvable' });
  res.json(rows[0]);
}

async function create(req, res) {
  const { nom, prix_vente, unite_stock, unite_achat, facteur_conversion, seuil_alerte } = req.body;
  if (!nom || prix_vente === undefined || !unite_stock) {
    return res.status(400).json({ message: 'nom, prix_vente et unite_stock sont requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO produits (nom, prix_vente, unite_stock, unite_achat, facteur_conversion, seuil_alerte)
       VALUES ($1, $2, $3, $4, COALESCE($5, 1), COALESCE($6, 0))
       RETURNING *`,
      [nom, prix_vente, unite_stock, unite_achat || null, facteur_conversion, seuil_alerte]
    );
    const produit = rows[0];
    await logAudit(client, {
      typeOperation: 'produit_creation',
      entiteId: produit.id,
      utilisateurId: req.user?.id,
      details: { nom, prix_vente },
    });
    await client.query('COMMIT');
    res.status(201).json(produit);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const { id } = req.params;
  const { nom, prix_vente, unite_stock, unite_achat, facteur_conversion, seuil_alerte } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query('SELECT * FROM produits WHERE id = $1 FOR UPDATE', [id]);
    if (existingRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Produit introuvable' });
    }
    const existing = existingRows[0];

    const nouveauPrix = prix_vente !== undefined ? prix_vente : existing.prix_vente;

    const { rows } = await client.query(
      `UPDATE produits SET
         nom = COALESCE($1, nom),
         prix_vente = $2,
         unite_stock = COALESCE($3, unite_stock),
         unite_achat = COALESCE($4, unite_achat),
         facteur_conversion = COALESCE($5, facteur_conversion),
         seuil_alerte = COALESCE($6, seuil_alerte),
         updated_at = now()
       WHERE id = $7
       RETURNING *`,
      [nom, nouveauPrix, unite_stock, unite_achat, facteur_conversion, seuil_alerte, id]
    );
    const produit = rows[0];

    // Regle stricte : tout changement de prix de vente est trace dans l'Historique.
    // Les ventes deja enregistrees restent figees et ne sont jamais recalculees.
    if (prix_vente !== undefined && Number(prix_vente) !== Number(existing.prix_vente)) {
      await client.query(
        `INSERT INTO historique_prix (produit_id, ancien_prix, nouveau_prix, auteur_id)
         VALUES ($1, $2, $3, $4)`,
        [id, existing.prix_vente, prix_vente, req.user?.id]
      );
      await logAudit(client, {
        typeOperation: 'produit_changement_prix',
        entiteId: Number(id),
        utilisateurId: req.user?.id,
        details: { ancien_prix: existing.prix_vente, nouveau_prix: prix_vente },
      });
    }

    await logAudit(client, {
      typeOperation: 'produit_modification',
      entiteId: Number(id),
      utilisateurId: req.user?.id,
    });

    await client.query('COMMIT');
    res.json(produit);
  } catch (err) {
    await client.query('ROLLBACK');
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
      'UPDATE produits SET actif = false, updated_at = now() WHERE id = $1 RETURNING *',
      [id]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Produit introuvable' });
    }
    await logAudit(client, {
      typeOperation: 'produit_desactivation',
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

async function historiquePrix(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM historique_prix WHERE produit_id = $1 ORDER BY date DESC',
    [req.params.id]
  );
  res.json(rows);
}

async function uploadPhoto(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier recu' });

  const relativePath = `uploads/produits/${req.file.filename}`;
  const { rows } = await pool.query(
    'UPDATE produits SET photo = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [relativePath, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ message: 'Produit introuvable' });
  res.json(rows[0]);
}

module.exports = { list, getById, create, update, desactiver, historiquePrix, uploadPhoto };
