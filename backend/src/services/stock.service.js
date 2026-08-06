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

// Le stock affiche du produit et la somme de ses lots doivent toujours coincider
// (c'est l'invariant verifie par `npm run check-integrity`). S'ils divergent, on
// refuse la vente : la valoriser quand meme produirait un cout d'acquisition
// sous-estime, donc une marge fausse dans les rapports, sans aucun signal.
class IncoherenceStockError extends Error {
  constructor(produitId, stockProduit, sommeLots) {
    super(
      `Incoherence de stock sur le produit ${produitId} : le stock indique ${stockProduit} `
      + `mais les lots n'en couvrent que ${sommeLots}. Lancez "npm run check-integrity".`
    );
    this.name = 'IncoherenceStockError';
    this.produitId = produitId;
    this.stockProduit = stockProduit;
    this.sommeLots = sommeLots;
  }
}

// Les quantites sont des NUMERIC(12,2) : en deca de ce seuil, l'ecart n'est que
// du bruit d'arrondi en virgule flottante, pas une vraie divergence.
const TOLERANCE_ARRONDI = 0.005;

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

  // facteur_conversion nul ou negatif donnerait une quantite de reference nulle,
  // donc un cout unitaire Infinity. PostgreSQL le rejette ensuite avec un
  // "numeric field overflow" incomprehensible pour l'utilisateur : on tranche ici.
  const facteur = Number(produit.facteur_conversion);
  if (!Number.isFinite(facteur) || facteur <= 0) {
    throw new Error(
      `Le produit ${produitId} a un facteur de conversion invalide (${produit.facteur_conversion}). `
      + 'Corrigez la fiche produit avant de saisir une entree de stock.'
    );
  }

  const quantiteRef = Number(quantiteAchat) * facteur;
  if (!Number.isFinite(quantiteRef) || quantiteRef <= 0) {
    throw new Error('La quantite achetee doit etre strictement positive');
  }

  const coutUnitaireRef = Number(coutAchatTotal) / quantiteRef;
  if (!Number.isFinite(coutUnitaireRef)) {
    throw new Error('Le cout d\'achat total est invalide');
  }

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
    `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, auteur_id, fournisseur_id, motif)
     VALUES ($1, 'entree', $2, $3, $4, $5, 'ravitaillement') RETURNING *`,
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

  // Les lots n'ont pas couvert la quantite : produits.quantite_stock et
  // lots_stock ont diverge. Sans ce controle, le cout FIFO serait calcule sur
  // la seule partie couverte puis divise par la quantite totale - soit un cout
  // d'acquisition trop bas et une marge surevaluee, en silence.
  if (restant > TOLERANCE_ARRONDI) {
    throw new IncoherenceStockError(
      produitId,
      stockDisponible,
      quantiteDemandee - restant
    );
  }

  const coutUnitaireApplique = methode === 'FIFO'
    ? coutTotalFifo / quantiteDemandee
    : Number(produit.cout_moyen_pondere);

  await client.query(
    `UPDATE produits SET quantite_stock = quantite_stock - $1, updated_at = now() WHERE id = $2`,
    [quantiteDemandee, produitId]
  );

  await client.query(
    `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, vente_id, auteur_id, motif)
     VALUES ($1, 'sortie', $2, $3, $4, $5, 'vente')`,
    [produitId, quantiteDemandee, coutUnitaireApplique, venteId, auteurId]
  );

  return { coutUnitaireApplique };
}

/**
 * Ajustement du stock hors vente : inventaire physique, perte, casse, vol,
 * retour client, correction de saisie.
 *
 * L'appelant fournit la quantite REELLEMENT comptee, pas un ecart. C'est ainsi
 * qu'on travaille en boutique : on compte ce qu'il y a dans le rayon. Demander
 * un ecart obligerait a faire la soustraction de tete, ce qui est precisement
 * la source d'erreur qu'on cherche a corriger.
 *
 * Les lots sont maintenus en coherence avec le stock, sans quoi la valorisation
 * FIFO deviendrait fausse au prochain passage en caisse.
 */
const MOTIFS_AJUSTEMENT = ['inventaire', 'perte', 'casse', 'vol', 'retour_client', 'correction'];

class MotifInvalideError extends Error {
  constructor(motif) {
    super(`Motif d'ajustement invalide : "${motif}". Valeurs acceptees : ${MOTIFS_AJUSTEMENT.join(', ')}.`);
    this.name = 'MotifInvalideError';
  }
}

async function ajusterStock(client, { produitId, quantiteReelle, motif, note = null, auteurId }) {
  if (!MOTIFS_AJUSTEMENT.includes(motif)) throw new MotifInvalideError(motif);

  const quantiteCible = Number(quantiteReelle);
  if (!Number.isFinite(quantiteCible) || quantiteCible < 0) {
    throw new Error('La quantite comptee doit etre un nombre positif ou nul');
  }

  const { rows: produitRows } = await client.query('SELECT * FROM produits WHERE id = $1 FOR UPDATE', [produitId]);
  const produit = produitRows[0];
  if (!produit) throw new Error('Produit introuvable');
  if (!produit.actif) throw new Error('Ce produit est archive : il ne peut plus etre ajuste');

  const stockAvant = Number(produit.quantite_stock);
  const ecart = quantiteCible - stockAvant;

  // Compter et retrouver exactement le stock theorique est le cas le plus
  // frequent d'un inventaire. Ce n'est pas une erreur, et cela ne merite pas
  // une ligne de mouvement : on le signale a l'appelant, sans rien ecrire.
  if (Math.abs(ecart) <= TOLERANCE_ARRONDI) {
    return { ecart: 0, produit, mouvement: null };
  }

  const cmp = Number(produit.cout_moyen_pondere);
  let coutUnitaire = cmp;

  if (ecart < 0) {
    // Sortie : on consomme les lots au plus ancien, comme une vente. Le cout
    // retenu est celui des lots reellement consommes, ce qui donne la valeur
    // exacte de la perte.
    const manquant = -ecart;
    const { rows: lots } = await client.query(
      `SELECT * FROM lots_stock WHERE produit_id = $1 AND quantite_restante > 0
       ORDER BY date_entree ASC FOR UPDATE`,
      [produitId]
    );
    let restant = manquant;
    let coutTotal = 0;
    for (const lot of lots) {
      if (restant <= 0) break;
      const pris = Math.min(restant, Number(lot.quantite_restante));
      coutTotal += pris * Number(lot.cout_unitaire);
      restant -= pris;
      await client.query('UPDATE lots_stock SET quantite_restante = quantite_restante - $1 WHERE id = $2', [pris, lot.id]);
    }
    // Les lots ne couvrent pas la sortie : le stock et les lots avaient deja
    // diverge. On refuse plutot que d'aggraver l'ecart en silence - c'est
    // exactement ce que `npm run check-integrity` sert a diagnostiquer.
    if (restant > TOLERANCE_ARRONDI) {
      throw new IncoherenceStockError(produitId, stockAvant, manquant - restant);
    }
    coutUnitaire = coutTotal / manquant;
  } else {
    // Entree : la marchandise retrouvee n'a pas de facture. On la valorise au
    // cout moyen actuel, seule valeur defendable ; a defaut (premier
    // approvisionnement jamais valorise) elle entre a zero.
    await client.query(
      `INSERT INTO lots_stock (produit_id, quantite_initiale, quantite_restante, cout_unitaire)
       VALUES ($1, $2, $2, $3)`,
      [produitId, ecart, cmp]
    );
    coutUnitaire = cmp;
  }

  // Le cout moyen n'est pas recalcule : un ajustement ne change pas le prix
  // auquel la marchandise a ete achetee, seulement la quantite detenue.
  const { rows: majRows } = await client.query(
    'UPDATE produits SET quantite_stock = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [quantiteCible, produitId]
  );

  const { rows: mouvementRows } = await client.query(
    `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, auteur_id, motif, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [produitId, ecart > 0 ? 'entree' : 'sortie', Math.abs(ecart), coutUnitaire, auteurId, motif, note]
  );

  await logAudit(client, {
    typeOperation: 'ajustement_stock',
    entiteId: produitId,
    utilisateurId: auteurId,
    details: {
      produit_nom: produit.nom,
      motif,
      note,
      ecart,
      valeur_ecart: Math.abs(ecart) * coutUnitaire,
    },
    avant: { quantite_stock: stockAvant, unite_stock: produit.unite_stock },
    apres: { quantite_stock: quantiteCible, unite_stock: produit.unite_stock },
  });

  return { ecart, produit: majRows[0], mouvement: mouvementRows[0] };
}

module.exports = {
  entreeStock,
  sortieStockPourVente,
  ajusterStock,
  getMethodeValorisation,
  MOTIFS_AJUSTEMENT,
  StockInsuffisantError,
  IncoherenceStockError,
  MotifInvalideError,
};
