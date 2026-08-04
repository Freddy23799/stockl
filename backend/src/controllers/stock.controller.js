const pool = require('../config/db');
const { entreeStock } = require('../services/stock.service');

async function etat(req, res) {
  const { rows } = await pool.query(
    `SELECT id, nom, photo, unite_stock, quantite_stock, seuil_alerte, cout_moyen_pondere,
            (quantite_stock <= seuil_alerte) AS en_alerte
     FROM produits WHERE actif = true ORDER BY nom`
  );
  res.json(rows);
}

async function alertes(req, res) {
  const { rows } = await pool.query(
    `SELECT id, nom, photo, unite_stock, quantite_stock, seuil_alerte
     FROM produits WHERE actif = true AND quantite_stock <= seuil_alerte ORDER BY quantite_stock ASC`
  );
  res.json(rows);
}

async function creerEntree(req, res) {
  const { produit_id, quantite_achat, cout_achat_total, fournisseur_id } = req.body;
  if (!produit_id || !(Number(quantite_achat) > 0) || cout_achat_total === undefined || Number(cout_achat_total) < 0) {
    return res.status(400).json({ message: 'produit_id, quantite_achat (> 0) et cout_achat_total sont requis' });
  }

  if (fournisseur_id) {
    const { rows: paramRows } = await pool.query('SELECT module_fournisseurs FROM parametres WHERE id = 1');
    if (!paramRows[0].module_fournisseurs) {
      return res.status(403).json({ message: 'Le module "fournisseurs" est desactive', code: 'MODULE_DESACTIVE', module: 'fournisseurs' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { produit, mouvement } = await entreeStock(client, {
      produitId: produit_id,
      quantiteAchat: quantite_achat,
      coutAchatTotal: cout_achat_total,
      auteurId: req.user.id,
      fournisseurId: fournisseur_id || null,
    });
    await client.query('COMMIT');
    res.status(201).json({ produit, mouvement });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function mouvements(req, res) {
  const { produit_id, type, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (produit_id) { params.push(produit_id); conditions.push(`m.produit_id = $${params.length}`); }
  if (type) { params.push(type); conditions.push(`m.type = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`m.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`m.date <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows: paramRows } = await pool.query('SELECT module_fournisseurs FROM parametres WHERE id = 1');
  const fournisseursActif = paramRows[0].module_fournisseurs;

  // Si le module fournisseurs est desactive, le lien fournisseur des mouvements
  // passes reste invisible tant qu'il est eteint (coherent avec le reste du systeme).
  const { rows } = await pool.query(
    `SELECT m.*, p.nom AS produit_nom${fournisseursActif ? ', f.nom AS fournisseur_nom' : ', NULL AS fournisseur_nom'}
     FROM mouvements_stock m
     JOIN produits p ON p.id = m.produit_id
     LEFT JOIN fournisseurs f ON f.id = m.fournisseur_id
     ${where} ORDER BY m.date DESC LIMIT 500`,
    params
  );
  res.json(fournisseursActif ? rows : rows.map((r) => ({ ...r, fournisseur_id: null, fournisseur_nom: null })));
}

module.exports = { etat, alertes, creerEntree, mouvements };
