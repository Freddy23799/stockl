const pool = require('../config/db');
const { logAudit } = require('../db/audit');
const { sortieStockPourVente, StockInsuffisantError, IncoherenceStockError } = require('../services/stock.service');
const { getPagination } = require('../utils/pagination');
const { reserverNumero, facturationActive } = require('../services/facture.service');

// Fiche vendeuse liee au compte connecte, si le role est 'vendeuse'. Une
// vendeuse connectee ne doit jamais pouvoir agir au nom d'une autre : ce
// lookup sert a IGNORER tout vendeuse_id/vendeuse_code venu du corps de la
// requete et a forcer la valeur qui lui appartient reellement.
async function vendeuseDuCompte(client, utilisateurId) {
  const { rows } = await client.query(
    'SELECT id, actif FROM vendeuses WHERE compte_utilisateur_id = $1',
    [utilisateurId]
  );
  return rows[0] || null;
}

async function list(req, res) {
  const { from, to, type } = req.query;
  let { vendeuse_id } = req.query;
  const conditions = [];
  const params = [];

  // Une vendeuse ne voit jamais que son propre historique, quel que soit le
  // filtre demande dans l'URL.
  if (req.user.role === 'vendeuse') {
    const vendeuse = await vendeuseDuCompte(pool, req.user.id);
    vendeuse_id = vendeuse ? vendeuse.id : 0;
  }

  if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`date <= $${params.length}`); }
  if (vendeuse_id) { params.push(vendeuse_id); conditions.push(`vendeuse_id = $${params.length}`); }
  if (type) { params.push(type); conditions.push(`type = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { page, pageSize, offset } = getPagination(req);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM ventes ${where}`, params);
  const { rows } = await pool.query(
    `SELECT v.*, vd.nom AS vendeuse_nom
     FROM ventes v LEFT JOIN vendeuses vd ON vd.id = v.vendeuse_id
     ${where} ORDER BY v.date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );
  res.json({ data: rows, total: countRows[0].total, page, pageSize });
}

async function getById(req, res) {
  const { rows: venteRows } = await pool.query(
    `SELECT v.*, vd.nom AS vendeuse_nom FROM ventes v
     LEFT JOIN vendeuses vd ON vd.id = v.vendeuse_id WHERE v.id = $1`,
    [req.params.id]
  );
  const vente = venteRows[0];
  if (!vente) return res.status(404).json({ message: 'Vente introuvable' });

  if (req.user.role === 'vendeuse') {
    const vendeuse = await vendeuseDuCompte(pool, req.user.id);
    if (!vendeuse || vente.vendeuse_id !== vendeuse.id) {
      return res.status(404).json({ message: 'Vente introuvable' });
    }
  }

  const { rows: lignes } = await pool.query(
    `SELECT vl.*, p.nom AS produit_nom, p.photo AS produit_photo
     FROM ventes_lignes vl JOIN produits p ON p.id = vl.produit_id
     WHERE vl.vente_id = $1`,
    [req.params.id]
  );
  res.json({ ...vente, lignes });
}

async function create(req, res) {
  let { type, vendeuse_id, vendeuse_code, lignes } = req.body;

  // Une vendeuse connectee enregistre TOUJOURS sa propre vente : tout
  // vendeuse_id/vendeuse_code envoye dans le corps est ignore, sans quoi elle
  // pourrait attribuer la vente a une collegue.
  if (req.user.role === 'vendeuse') {
    const vendeuse = await vendeuseDuCompte(pool, req.user.id);
    if (!vendeuse || !vendeuse.actif) {
      return res.status(403).json({ message: 'Aucune fiche vendeuse active n\'est liee a ce compte' });
    }
    type = 'vendeuse';
    vendeuse_id = vendeuse.id;
    vendeuse_code = undefined;
  } else if (vendeuse_code && !vendeuse_id) {
    // Identification par code a 6 chiffres : la vendeuse presente son code au
    // moment de la vente, la vente est enregistree comme si c'etait elle qui
    // avait vendu - sans compte ni session. Reserve aux comptes qui operent
    // la caisse (admin), pas a une vendeuse deja connectee (cas ci-dessus).
    const { rows: parCodeRows } = await pool.query('SELECT id, actif FROM vendeuses WHERE code = $1', [vendeuse_code]);
    if (parCodeRows.length === 0) {
      return res.status(400).json({ message: 'Aucune vendeuse ne correspond a ce code' });
    }
    type = 'vendeuse';
    vendeuse_id = parCodeRows[0].id;
  }

  if (!['directe', 'vendeuse'].includes(type)) {
    return res.status(400).json({ message: "type doit etre 'directe' ou 'vendeuse'" });
  }
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ message: 'Au moins une ligne de vente est requise' });
  }
  for (const l of lignes) {
    if (!l.produit_id || !(Number(l.quantite) > 0)) {
      return res.status(400).json({ message: 'Chaque ligne doit avoir produit_id et une quantite > 0' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let vendeuseNom = null;
    if (type === 'vendeuse') {
      const { rows: vendeuseRows } = await client.query('SELECT * FROM vendeuses WHERE id = $1', [vendeuse_id]);
      const vendeuse = vendeuseRows[0];
      if (!vendeuse || !vendeuse.actif) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La vente doit referencer une vendeuse active' });
      }
      vendeuseNom = vendeuse.nom;
    }

    // Le numero de facture est attribue ICI, dans la transaction de la vente :
    // il ne bougera plus jamais, et une facture reimprimee dans six mois portera
    // exactement le meme. Le calculer au moment d'imprimer donnerait un numero
    // different a chaque tirage.
    const numeroFacture = (await facturationActive(client))
      ? await reserverNumero(client)
      : null;

    const { rows: venteRows } = await client.query(
      `INSERT INTO ventes (type, vendeuse_id, montant_total, auteur_id, numero_facture)
       VALUES ($1, $2, 0, $3, $4) RETURNING *`,
      [type, type === 'vendeuse' ? vendeuse_id : null, req.user.id, numeroFacture]
    );
    const vente = venteRows[0];

    // Verrouillage des produits dans un ordre constant (id croissant) pour eviter les deadlocks
    // entre ventes concurrentes qui partagent des produits.
    const lignesTriees = [...lignes].sort((a, b) => a.produit_id - b.produit_id);

    let montantTotal = 0;
    const lignesCreees = [];
    const apercuLignes = [];
    for (const ligne of lignesTriees) {
      const { rows: produitRows } = await client.query('SELECT * FROM produits WHERE id = $1', [ligne.produit_id]);
      const produit = produitRows[0];
      if (!produit || !produit.actif) {
        throw new Error(`Produit ${ligne.produit_id} introuvable ou inactif`);
      }

      const { coutUnitaireApplique } = await sortieStockPourVente(client, {
        produitId: ligne.produit_id,
        quantite: ligne.quantite,
        venteId: vente.id,
        auteurId: req.user.id,
      });

      const prixVenteSnapshot = Number(produit.prix_vente);
      montantTotal += prixVenteSnapshot * Number(ligne.quantite);

      const { rows: ligneRows } = await client.query(
        `INSERT INTO ventes_lignes (vente_id, produit_id, quantite, prix_vente_snapshot, cout_acquisition_snapshot)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [vente.id, ligne.produit_id, ligne.quantite, prixVenteSnapshot, coutUnitaireApplique]
      );
      lignesCreees.push(ligneRows[0]);
      apercuLignes.push(`${produit.nom} x ${Number(ligne.quantite)}`);
    }

    const { rows: venteFinaleRows } = await client.query(
      'UPDATE ventes SET montant_total = $1 WHERE id = $2 RETURNING *',
      [montantTotal, vente.id]
    );

    // Une vente peut compter des dizaines de lignes : le journal en garde un
    // apercu (les premieres, plus le compte exact), pas la copie complete.
    // Le detail integral reste consultable sur la vente elle-meme.
    await logAudit(client, {
      typeOperation: 'vente_creation',
      entiteId: vente.id,
      utilisateurId: req.user.id,
      details: {
        type,
        vendeuse_id: type === 'vendeuse' ? vendeuse_id : null,
        vendeuse_nom: vendeuseNom,
        montant_total: montantTotal,
        nombre_lignes: lignesCreees.length,
        lignes_apercu: apercuLignes,
      },
    });

    await client.query('COMMIT');
    res.status(201).json({ ...venteFinaleRows[0], lignes: lignesCreees });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof StockInsuffisantError) {
      return res.status(409).json({ message: err.message, code: 'STOCK_INSUFFISANT', produit_id: err.produitId, disponible: err.disponible, demande: err.demande });
    }
    if (err instanceof IncoherenceStockError) {
      return res.status(409).json({
        message: err.message,
        code: 'INCOHERENCE_STOCK',
        produit_id: err.produitId,
        stock_indique: err.stockProduit,
        couvert_par_les_lots: err.sommeLots,
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { list, getById, create };
