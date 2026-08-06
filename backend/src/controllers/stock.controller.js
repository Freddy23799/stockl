const pool = require('../config/db');
const { preparerAudit, completerAudit } = require('../db/audit');
const {
  entreeStock, ajusterStock, MOTIFS_AJUSTEMENT,
  MotifInvalideError, IncoherenceStockError,
} = require('../services/stock.service');
const { getPagination } = require('../utils/pagination');

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

async function nomFournisseur(client, fournisseurId) {
  const { rows } = await client.query('SELECT nom FROM fournisseurs WHERE id = $1', [fournisseurId]);
  return rows[0]?.nom || null;
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

    // C'est `entreeStock` qui ecrit la ligne d'audit, mais lui seul ne voit pas
    // l'operation de bout en bout : on encadre l'appel pour capturer le stock
    // d'avant (lu dans la meme transaction) et celui d'apres, plus les libelles
    // qui ne seront plus recuperables si la fiche est renommee ou archivee.
    const { rows: avantRows } = await client.query(
      'SELECT nom, unite_stock, quantite_stock, cout_moyen_pondere FROM produits WHERE id = $1',
      [produit_id]
    );
    const fournisseurNom = fournisseur_id ? await nomFournisseur(client, fournisseur_id) : null;
    preparerAudit(client, {
      typeOperation: 'entree_stock',
      details: { produit_nom: avantRows[0]?.nom || null, fournisseur_nom: fournisseurNom },
      avant: avantRows[0]
        ? {
          quantite_stock: avantRows[0].quantite_stock,
          cout_moyen_pondere: avantRows[0].cout_moyen_pondere,
          unite_stock: avantRows[0].unite_stock,
        }
        : null,
    });

    const { produit, mouvement } = await entreeStock(client, {
      produitId: produit_id,
      quantiteAchat: quantite_achat,
      coutAchatTotal: cout_achat_total,
      auteurId: req.user.id,
      fournisseurId: fournisseur_id || null,
    });

    await completerAudit(client, {
      typeOperation: 'entree_stock',
      apres: {
        quantite_stock: produit.quantite_stock,
        cout_moyen_pondere: produit.cout_moyen_pondere,
        unite_stock: produit.unite_stock,
      },
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

// Ajustement du stock hors vente : inventaire, perte, casse, vol, retour,
// correction. Le stock ne pouvait jusqu'ici baisser que par une vente, ce qui
// obligeait a inventer une vente pour corriger un ecart - et faussait le
// chiffre d'affaires.
async function ajuster(req, res) {
  const { produit_id, quantite_reelle, motif, note } = req.body;
  if (!produit_id || quantite_reelle === undefined || quantite_reelle === null || !motif) {
    return res.status(400).json({ message: 'produit_id, quantite_reelle et motif sont requis' });
  }
  // Une saisie invalide doit revenir en 400 avec une phrase lisible. Sans ce
  // controle, le garde-fou du service leve une erreur generique qui ressort en
  // 500 : l'utilisateur croit a une panne alors qu'il a juste tape un signe moins.
  const quantite = Number(quantite_reelle);
  if (!Number.isFinite(quantite) || quantite < 0) {
    return res.status(400).json({
      message: 'La quantite comptee doit etre un nombre positif ou nul.',
      code: 'QUANTITE_INVALIDE',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultat = await ajusterStock(client, {
      produitId: produit_id,
      quantiteReelle: quantite_reelle,
      motif,
      note: note || null,
      auteurId: req.user.id,
    });
    await client.query('COMMIT');
    res.json({
      ecart: resultat.ecart,
      produit: resultat.produit,
      mouvement: resultat.mouvement,
      // Un ecart nul est un resultat normal d'inventaire, pas un echec : on le
      // dit explicitement pour que l'interface affiche le bon message.
      message: resultat.ecart === 0
        ? 'Le stock compte correspond au stock enregistre : aucun ajustement necessaire.'
        : null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof MotifInvalideError) {
      return res.status(400).json({ message: err.message, code: 'MOTIF_INVALIDE' });
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

async function mouvements(req, res) {
  const { produit_id, type, motif, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (produit_id) { params.push(produit_id); conditions.push(`m.produit_id = $${params.length}`); }
  if (type) { params.push(type); conditions.push(`m.type = $${params.length}`); }
  // `pertes` regroupe les motifs qui representent de la marchandise perdue :
  // c'est la question qu'on se pose reellement ("combien ai-je perdu ?"), pas
  // "montre-moi les casses" puis "montre-moi les vols".
  if (motif === 'pertes') {
    conditions.push("m.motif IN ('perte', 'casse', 'vol')");
  } else if (motif) {
    params.push(motif); conditions.push(`m.motif = $${params.length}`);
  }
  if (from) { params.push(from); conditions.push(`m.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`m.date <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows: paramRows } = await pool.query('SELECT module_fournisseurs FROM parametres WHERE id = 1');
  const fournisseursActif = paramRows[0].module_fournisseurs;
  const { page, pageSize, offset } = getPagination(req);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM mouvements_stock m ${where}`, params);

  // Si le module fournisseurs est desactive, le lien fournisseur des mouvements
  // passes reste invisible tant qu'il est eteint (coherent avec le reste du systeme).
  const { rows } = await pool.query(
    `SELECT m.*, p.nom AS produit_nom${fournisseursActif ? ', f.nom AS fournisseur_nom' : ', NULL AS fournisseur_nom'}
     FROM mouvements_stock m
     JOIN produits p ON p.id = m.produit_id
     LEFT JOIN fournisseurs f ON f.id = m.fournisseur_id
     ${where} ORDER BY m.date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );
  const data = fournisseursActif ? rows : rows.map((r) => ({ ...r, fournisseur_id: null, fournisseur_nom: null }));
  res.json({ data, total: countRows[0].total, page, pageSize });
}

module.exports = { etat, alertes, creerEntree, ajuster, mouvements, MOTIFS_AJUSTEMENT };
