const { logAudit } = require('../db/audit');

class StockInsuffisantError extends Error {
  constructor(produitId, disponible, demande) {
    super(`Stock insuffisant pour le produit ${produitId} (disponible: ${disponible}, demande: ${demande})`);
    this.name = 'StockInsuffisantError';
    this.produitId = produitId;
    this.disponible = disponible;
    this.demande = demande;
  }
}

async function getMethodeValorisation(client) {
  const { rows } = await client.query('SELECT methode_valorisation FROM parametres WHERE id = 1');
  return rows[0].methode_valorisation;
}

/**
 * Entree de stock (ravitaillement). Le prix est saisi dans l'unite d'achat choisie ;
 * cette fonction convertit et stocke automatiquement le cout par unite de reference.
 * Cree un lot FIFO et met a jour le CMP en parallele (les deux sont toujours tenus a
 * jour, seule la methode active dans Parametres est utilisee au moment d'une vente).
 */
async function entreeStock(client, { produitId, quantiteAchat, coutAchatTotal, auteurId, fournisseurId = null }) {
  const { rows: produitRows } = await client.query('SELECT * FROM produits WHERE id = $1 FOR UPDATE', [produitId]);
  const produit = produitRows[0];
  if (!produit) throw new Error('Produit introuvable');

  if (fournisseurId) {
    const { rows: fournisseurRows } = await client.query('SELECT actif FROM fournisseurs WHERE id = $1', [fournisseurId]);
    if (fournisseurRows.length === 0 || !fournisseurRows[0].actif) {
      throw new Error('Fournisseur introuvable ou inactif');
    }
  }

  const quantiteRef = Number(quantiteAchat) * Number(produit.facteur_conversion);
  const coutUnitaireRef = Number(coutAchatTotal) / quantiteRef;

  await client.query(
    `INSERT INTO lots_stock (produit_id, quantite_initiale, quantite_restante, cout_unitaire, fournisseur_id)
     VALUES ($1, $2, $2, $3, $4)`,
    [produitId, quantiteRef, coutUnitaireRef, fournisseurId]
  );

  const stockActuel = Number(produit.quantite_stock);
  const cmpActuel = Number(produit.cout_moyen_pondere);
  const nouveauStock = stockActuel + quantiteRef;
  const nouveauCmp = nouveauStock > 0
    ? (stockActuel * cmpActuel + quantiteRef * coutUnitaireRef) / nouveauStock
    : 0;

  const { rows: updatedRows } = await client.query(
    `UPDATE produits SET quantite_stock = $1, cout_moyen_pondere = $2, updated_at = now()
     WHERE id = $3 RETURNING *`,
    [nouveauStock, nouveauCmp, produitId]
  );

  const { rows: mouvementRows } = await client.query(
    `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, auteur_id, fournisseur_id)
     VALUES ($1, 'entree', $2, $3, $4, $5) RETURNING *`,
    [produitId, quantiteRef, coutUnitaireRef, auteurId, fournisseurId]
  );

  await logAudit(client, {
    typeOperation: 'entree_stock',
    entiteId: produitId,
    utilisateurId: auteurId,
    details: { quantite_achat: quantiteAchat, cout_achat_total: coutAchatTotal, quantite_reference: quantiteRef, cout_unitaire_reference: coutUnitaireRef, fournisseur_id: fournisseurId },
  });

  return { produit: updatedRows[0], mouvement: mouvementRows[0] };
}

/**
 * Sortie de stock consommee par une vente. Valorisee via FIFO ou CMP selon la
 * methode configuree, au moment precis de la vente - jamais recalculee apres coup.
 * Bloque si le stock disponible est insuffisant (le stock ne peut jamais devenir negatif).
 */
async function sortieStockPourVente(client, { produitId, quantite, venteId, auteurId }) {
  const { rows: produitRows } = await client.query('SELECT * FROM produits WHERE id = $1 FOR UPDATE', [produitId]);
  const produit = produitRows[0];
  if (!produit) throw new Error('Produit introuvable');

  const quantiteDemandee = Number(quantite);
  const stockDisponible = Number(produit.quantite_stock);
  if (stockDisponible < quantiteDemandee) {
    throw new StockInsuffisantError(produitId, stockDisponible, quantiteDemandee);
  }

  const methode = await getMethodeValorisation(client);

  // Les lots sont toujours consommes FIFO, quelle que soit la methode active :
  // lots_stock doit toujours refleter fidelement le stock physique restant,
  // pour rester coherent si la methode de valorisation est changee plus tard.
  // Seule la valeur de cout appliquee a la vente differe selon FIFO ou CMP.
  const { rows: lots } = await client.query(
    `SELECT * FROM lots_stock WHERE produit_id = $1 AND quantite_restante > 0
     ORDER BY date_entree ASC FOR UPDATE`,
    [produitId]
  );
  let restant = quantiteDemandee;
  let coutTotalFifo = 0;
  for (const lot of lots) {
    if (restant <= 0) break;
    const pris = Math.min(restant, Number(lot.quantite_restante));
    coutTotalFifo += pris * Number(lot.cout_unitaire);
    restant -= pris;
    await client.query('UPDATE lots_stock SET quantite_restante = quantite_restante - $1 WHERE id = $2', [pris, lot.id]);
  }

  const coutUnitaireApplique = methode === 'FIFO'
    ? coutTotalFifo / quantiteDemandee
    : Number(produit.cout_moyen_pondere);

  await client.query(
    `UPDATE produits SET quantite_stock = quantite_stock - $1, updated_at = now() WHERE id = $2`,
    [quantiteDemandee, produitId]
  );

  await client.query(
    `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, vente_id, auteur_id)
     VALUES ($1, 'sortie', $2, $3, $4, $5)`,
    [produitId, quantiteDemandee, coutUnitaireApplique, venteId, auteurId]
  );

  return { coutUnitaireApplique };
}

module.exports = { entreeStock, sortieStockPourVente, getMethodeValorisation, StockInsuffisantError };
