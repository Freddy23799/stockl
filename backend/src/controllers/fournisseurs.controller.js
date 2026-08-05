const pool = require('../config/db');
const { logAudit } = require('../db/audit');

async function list(req, res) {
  const includeInactifs = req.query.includeInactifs === 'true';
  const { rows } = await pool.query(
    includeInactifs
      ? 'SELECT * FROM fournisseurs ORDER BY nom'
      : 'SELECT * FROM fournisseurs WHERE actif = true ORDER BY nom'
  );
  res.json(rows);
}

async function totauxPourPeriode(from, to) {
  const conditionsJoin = [`m.fournisseur_id = f.id`, `m.type = 'entree'`];
  const params = [];
  if (from) { params.push(from); conditionsJoin.push(`m.date >= $${params.length}`); }
  if (to) { params.push(to); conditionsJoin.push(`m.date <= $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT f.id, f.nom, f.contact, f.actif,
            COALESCE(COUNT(m.id), 0) AS nombre_achats,
            COALESCE(SUM(m.quantite), 0) AS quantite_totale,
            COALESCE(SUM(m.quantite * m.cout_unitaire), 0) AS montant_total
     FROM fournisseurs f
     LEFT JOIN mouvements_stock m ON ${conditionsJoin.join(' AND ')}
     GROUP BY f.id, f.nom, f.contact, f.actif
     ORDER BY montant_total DESC`,
    params
  );
  return rows.map((r) => ({
    ...r,
    nombre_achats: Number(r.nombre_achats),
    quantite_totale: Number(r.quantite_totale),
    montant_total: Number(r.montant_total),
  }));
}

// Vue d'ensemble : tous les fournisseurs avec leur total achete (page de stats).
// Si from/to sont fournis, ajoute une comparaison vs la periode precedente de
// meme duree (tendance de livraison/depense par fournisseur, calculee localement).
async function listAvecTotaux(req, res) {
  const { from, to } = req.query;
  const actuel = await totauxPourPeriode(from, to);

  if (!from || !to) {
    res.json(actuel);
    return;
  }

  const dureeMs = new Date(to).getTime() - new Date(from).getTime();
  const fromPrecedent = new Date(new Date(from).getTime() - dureeMs).toISOString();
  const precedent = await totauxPourPeriode(fromPrecedent, from);
  const precedentParId = new Map(precedent.map((f) => [f.id, f]));

  const avecComparaison = actuel.map((f) => {
    const avant = precedentParId.get(f.id);
    const montantAvant = avant ? avant.montant_total : 0;
    let variationPourcentage = null;
    if (montantAvant > 0) {
      variationPourcentage = ((f.montant_total - montantAvant) / montantAvant) * 100;
    } else if (f.montant_total > 0) {
      variationPourcentage = 100;
    }
    return { ...f, montant_periode_precedente: montantAvant, variation_pourcentage: variationPourcentage };
  });

  res.json(avecComparaison);
}

async function getById(req, res) {
  const { rows } = await pool.query('SELECT * FROM fournisseurs WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ message: 'Fournisseur introuvable' });
  res.json(rows[0]);
}

async function create(req, res) {
  const { nom, contact } = req.body;
  if (!nom) return res.status(400).json({ message: 'nom est requis' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO fournisseurs (nom, contact) VALUES ($1, $2) RETURNING *',
      [nom, contact || null]
    );
    await logAudit(client, {
      typeOperation: 'fournisseur_creation',
      entiteId: rows[0].id,
      utilisateurId: req.user.id,
      details: { fournisseur_nom: rows[0].nom },
      apres: { nom: rows[0].nom, contact: rows[0].contact, actif: rows[0].actif },
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
    'UPDATE fournisseurs SET nom = COALESCE($1, nom), contact = COALESCE($2, contact) WHERE id = $3 RETURNING *',
    [nom, contact, id]
  );
  if (rows.length === 0) return res.status(404).json({ message: 'Fournisseur introuvable' });
  res.json(rows[0]);
}

function setActif(actif) {
  return async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existants } = await client.query('SELECT * FROM fournisseurs WHERE id = $1 FOR UPDATE', [id]);
      if (existants.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Fournisseur introuvable' });
      }
      const existant = existants[0];

      const { rows } = await client.query('UPDATE fournisseurs SET actif = $1 WHERE id = $2 RETURNING *', [actif, id]);
      await logAudit(client, {
        typeOperation: actif ? 'fournisseur_activation' : 'fournisseur_desactivation',
        entiteId: Number(id),
        utilisateurId: req.user.id,
        details: { fournisseur_nom: existant.nom },
        avant: { actif: existant.actif },
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

// Historique des achats pour un fournisseur donne, filtrable par periode
async function historique(req, res) {
  const { id } = req.params;
  const { from, to } = req.query;
  const conditions = [`m.fournisseur_id = $1`, `m.type = 'entree'`];
  const params = [id];
  if (from) { params.push(from); conditions.push(`m.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`m.date <= $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT m.*, p.nom AS produit_nom, p.photo AS produit_photo
     FROM mouvements_stock m JOIN produits p ON p.id = m.produit_id
     WHERE ${conditions.join(' AND ')} ORDER BY m.date DESC LIMIT 500`,
    params
  );
  res.json(rows);
}

// Total achete pour un fournisseur donne, sur une periode
async function total(req, res) {
  const { id } = req.params;
  const { from, to } = req.query;
  const conditions = [`fournisseur_id = $1`, `type = 'entree'`];
  const params = [id];
  if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`date <= $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT COALESCE(COUNT(*), 0) AS nombre_achats,
            COALESCE(SUM(quantite), 0) AS quantite_totale,
            COALESCE(SUM(quantite * cout_unitaire), 0) AS montant_total
     FROM mouvements_stock WHERE ${conditions.join(' AND ')}`,
    params
  );
  res.json(rows[0]);
}

module.exports = {
  list,
  listAvecTotaux,
  getById,
  create,
  update,
  historique,
  total,
  activer: setActif(true),
  desactiver: setActif(false),
};
