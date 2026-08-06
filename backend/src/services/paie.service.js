const { logAudit } = require('../db/audit');
const { genererReferenceCycleUnique, genererNumeroRecuUnique } = require('../utils/identifiants-rh');
const { salaireALaDate } = require('./employes.service');

// -----------------------------------------------------------------------------
// Paie.
//
// Regle qui gouverne tout ce fichier : ce qui a ete paye ne bouge plus.
//
// Un cycle fige, a sa creation, le nom, la fonction et le salaire de chaque
// employe. Rouvrir un cycle de juillet en decembre doit afficher exactement ce
// qui a ete verse en juillet, meme si la personne a change de poste, a ete
// augmentee, ou a quitte l'entreprise depuis. C'est la raison des colonnes
// "_snapshot" : elles evitent une jointure qui donnerait la valeur d'aujourd'hui
// pour un paiement d'hier.
//
// Deux natures d'ajustement, a ne pas confondre :
//
//   GENERAL      decide a la creation du cycle, applique a tout le monde
//                (prime de fin d'annee, retenue exceptionnelle) ;
//   PARTICULIER  decide au moment de payer une personne en particulier.
//
// Ni l'un ni l'autre ne touche a la carriere de l'employe : ce sont des
// mouvements ponctuels, valables pour ce cycle seulement. Une augmentation
// durable passe par la carriere, pas par la paie.
// -----------------------------------------------------------------------------

class CycleClotureError extends Error {
  constructor() {
    super('Ce cycle de paie est cloture : il ne peut plus etre modifie.');
    this.name = 'CycleClotureError';
    this.code = 'CYCLE_CLOTURE';
  }
}

class MontantVersementError extends Error {
  constructor(message, code = 'MONTANT_INVALIDE') {
    super(message);
    this.name = 'MontantVersementError';
    this.code = code;
  }
}

/** Applique l'ajustement general a un salaire de base. */
function calculerAjustementGeneral(salaireBase, cycle) {
  if (!cycle.ajustement_sens || !cycle.ajustement_valeur) return 0;
  const valeur = Number(cycle.ajustement_valeur);
  const brut = cycle.ajustement_mode === 'pourcentage'
    ? (Number(salaireBase) * valeur) / 100
    : valeur;
  const signe = cycle.ajustement_sens === 'diminution' ? -1 : 1;
  return signe * brut;
}

/**
 * Le net a payer ne descend jamais sous zero : une retenue superieure au
 * salaire donnerait un montant negatif, que la contrainte de base rejetterait
 * avec un message incomprehensible. On plafonne, et l'ecart reste visible dans
 * le detail des ajustements.
 */
function calculerNet(salaireBase, ajustementGeneral, ajustementParticulier) {
  const net = Number(salaireBase) + Number(ajustementGeneral) + Number(ajustementParticulier);
  return Math.max(0, Number(net.toFixed(2)));
}

/**
 * Cree un cycle de paie et y inscrit tous les employes actifs.
 *
 * Le salaire retenu est celui en vigueur a la FIN de la periode couverte, et
 * non celui d'aujourd'hui : un cycle de juillet cree en septembre, apres une
 * augmentation d'aout, doit payer le salaire de juillet.
 */
async function creerCycle(client, {
  libelle, periodeDebut, periodeFin,
  ajustementSens, ajustementMode, ajustementValeur, ajustementMotif,
  auteurId,
}) {
  const reference = await genererReferenceCycleUnique(client);

  const { rows: cycleRows } = await client.query(
    `INSERT INTO paie_cycles
       (reference, libelle, periode_debut, periode_fin,
        ajustement_sens, ajustement_mode, ajustement_valeur, ajustement_motif, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      reference, libelle || null, periodeDebut, periodeFin,
      ajustementSens || null, ajustementMode || null,
      ajustementValeur === undefined || ajustementValeur === null || ajustementValeur === ''
        ? null : ajustementValeur,
      ajustementMotif || null, auteurId,
    ]
  );
  const cycle = cycleRows[0];

  const { rows: employes } = await client.query(
    'SELECT id, matricule, prenom, nom FROM employes WHERE actif = true ORDER BY nom, prenom'
  );

  const lignes = [];
  for (const employe of employes) {
    const carriere = await salaireALaDate(client, employe.id, periodeFin);
    // Un employe sans periode de carriere couvrant la fin du cycle n'a pas de
    // salaire defini a cette date : il est ecarte plutot que paye a zero, ce
    // qui produirait un bulletin vide et un recu absurde.
    if (!carriere) continue;

    const salaireBase = Number(carriere.montant);
    const ajustementGeneral = calculerAjustementGeneral(salaireBase, cycle);
    const net = calculerNet(salaireBase, ajustementGeneral, 0);

    const { rows } = await client.query(
      `INSERT INTO paie_lignes
         (cycle_id, employe_id, matricule_snapshot, nom_complet_snapshot, fonction_snapshot,
          salaire_base, ajustement_general, net_a_payer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        cycle.id, employe.id, employe.matricule,
        `${employe.prenom} ${employe.nom}`.trim(), carriere.fonction,
        salaireBase, ajustementGeneral, net,
      ]
    );
    lignes.push(rows[0]);
  }

  await logAudit(client, {
    typeOperation: 'paie_cycle_creation',
    entiteId: cycle.id,
    utilisateurId: auteurId,
    details: {
      reference,
      libelle: libelle || null,
      effectif: lignes.length,
      total_a_payer: lignes.reduce((s, l) => s + Number(l.net_a_payer), 0),
    },
    apres: { reference, periode_debut: periodeDebut, periode_fin: periodeFin },
  });

  return { cycle, lignes };
}

/**
 * Ajustement propre a une personne, dans un cycle donne.
 * Recalcule le net et refuse de descendre sous ce qui a deja ete verse.
 */
async function ajusterLigne(client, { ligneId, montant, motif, auteurId }) {
  const { rows: existantes } = await client.query(
    `SELECT l.*, c.statut AS cycle_statut
       FROM paie_lignes l JOIN paie_cycles c ON c.id = l.cycle_id
      WHERE l.id = $1 FOR UPDATE OF l`,
    [ligneId]
  );
  const ligne = existantes[0];
  if (!ligne) return null;
  if (ligne.cycle_statut === 'cloture') throw new CycleClotureError();

  const nouveauNet = calculerNet(ligne.salaire_base, ligne.ajustement_general, montant);

  // Une retenue qui ramenerait le net sous les sommes deja versees rendrait la
  // ligne incoherente : on aurait paye plus que du. La contrainte de base
  // l'interdit aussi, mais un message clair vaut mieux qu'une erreur SQL.
  if (nouveauNet < Number(ligne.montant_paye)) {
    throw new MontantVersementError(
      `Cet ajustement ramenerait le net a payer en dessous des sommes deja versees `
      + `(${ligne.montant_paye}). Annulez d'abord les versements concernes.`,
      'AJUSTEMENT_SOUS_VERSEMENTS'
    );
  }

  const statut = nouveauNet === 0
    ? 'paye'
    : Number(ligne.montant_paye) === 0
      ? 'non_paye'
      : Number(ligne.montant_paye) >= nouveauNet ? 'paye' : 'partiel';

  const { rows } = await client.query(
    `UPDATE paie_lignes
        SET ajustement_particulier = $1, ajustement_motif = $2, net_a_payer = $3, statut = $4
      WHERE id = $5 RETURNING *`,
    [montant, motif || null, nouveauNet, statut, ligneId]
  );

  await logAudit(client, {
    typeOperation: 'paie_ajustement_particulier',
    entiteId: ligne.cycle_id,
    utilisateurId: auteurId,
    details: {
      nom_complet: ligne.nom_complet_snapshot,
      matricule: ligne.matricule_snapshot,
      motif: motif || null,
    },
    avant: { ajustement_particulier: ligne.ajustement_particulier, net_a_payer: ligne.net_a_payer },
    apres: { ajustement_particulier: montant, net_a_payer: nouveauNet },
  });

  return rows[0];
}

/**
 * Enregistre un versement et produit le numero de recu.
 *
 * Un solde en trois fois donne trois recus : chacun atteste d'un paiement reel,
 * a une date reelle. C'est ce qui permet de rouvrir un cycle des annees apres
 * et de savoir qui a touche quoi, et quand.
 */
async function enregistrerVersement(client, { ligneId, montant, modePaiement, note, auteurId }) {
  const { rows: existantes } = await client.query(
    `SELECT l.*, c.statut AS cycle_statut, c.reference AS cycle_reference
       FROM paie_lignes l JOIN paie_cycles c ON c.id = l.cycle_id
      WHERE l.id = $1 FOR UPDATE OF l`,
    [ligneId]
  );
  const ligne = existantes[0];
  if (!ligne) return null;
  if (ligne.cycle_statut === 'cloture') throw new CycleClotureError();

  const verse = Number(montant);
  if (!Number.isFinite(verse) || verse <= 0) {
    throw new MontantVersementError('Le montant verse doit etre strictement positif.');
  }

  const restant = Number(ligne.net_a_payer) - Number(ligne.montant_paye);
  if (restant <= 0) {
    throw new MontantVersementError('Cette ligne est deja soldee.', 'DEJA_SOLDEE');
  }
  // Un versement superieur au reste du est refuse : la contrainte de base
  // l'interdit, et accepter un trop-percu sans le dire creerait un ecart de
  // caisse invisible.
  if (verse > restant + 0.005) {
    throw new MontantVersementError(
      `Le montant verse (${verse}) depasse le reste a payer (${restant.toFixed(2)}).`,
      'DEPASSE_RESTE_DU'
    );
  }

  const nouveauPaye = Number((Number(ligne.montant_paye) + verse).toFixed(2));
  const estSolde = nouveauPaye >= Number(ligne.net_a_payer) - 0.005;
  const numeroRecu = await genererNumeroRecuUnique(client);

  const { rows: versementRows } = await client.query(
    `INSERT INTO paie_versements (ligne_id, numero_recu, montant, mode_paiement, note, est_solde, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [ligneId, numeroRecu, verse, modePaiement || null, note || null, estSolde, auteurId]
  );

  await client.query(
    'UPDATE paie_lignes SET montant_paye = $1, statut = $2 WHERE id = $3',
    [nouveauPaye, estSolde ? 'paye' : 'partiel', ligneId]
  );

  await logAudit(client, {
    typeOperation: 'paie_versement',
    entiteId: ligne.cycle_id,
    utilisateurId: auteurId,
    details: {
      numero_recu: numeroRecu,
      nom_complet: ligne.nom_complet_snapshot,
      matricule: ligne.matricule_snapshot,
      montant: verse,
      est_solde: estSolde,
    },
    avant: { montant_paye: ligne.montant_paye, statut: ligne.statut },
    apres: { montant_paye: nouveauPaye, statut: estSolde ? 'paye' : 'partiel' },
  });

  return { versement: versementRows[0], ligne: { ...ligne, montant_paye: nouveauPaye } };
}

/** Totaux d'un cycle, calcules en une seule requete. */
async function totauxCycle(client, cycleId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS effectif,
            COALESCE(SUM(net_a_payer), 0) AS total_a_payer,
            COALESCE(SUM(montant_paye), 0) AS total_paye,
            COALESCE(SUM(net_a_payer - montant_paye), 0) AS reste_a_payer,
            count(*) FILTER (WHERE statut = 'paye')::int AS nombre_payes,
            count(*) FILTER (WHERE statut = 'partiel')::int AS nombre_partiels,
            count(*) FILTER (WHERE statut = 'non_paye')::int AS nombre_non_payes
       FROM paie_lignes WHERE cycle_id = $1`,
    [cycleId]
  );
  return rows[0];
}

module.exports = {
  creerCycle,
  ajusterLigne,
  enregistrerVersement,
  totauxCycle,
  calculerAjustementGeneral,
  calculerNet,
  CycleClotureError,
  MontantVersementError,
};
