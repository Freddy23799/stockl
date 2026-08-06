const { logAudit } = require('../db/audit');

// -----------------------------------------------------------------------------
// Carriere d'un employe : salaire ET fonction, decoupes en periodes.
//
// Deux operations distinctes, et la difference compte :
//
//   AJOUTER   ouvre une nouvelle periode. L'ancienne est fermee la veille, et
//             conservee. C'est ce qu'on fait pour une augmentation, une
//             promotion, un changement de poste : l'historique doit garder la
//             trace de ce qui etait verse avant.
//
//   CORRIGER  rectifie la periode EN COURS sans en creer de nouvelle. C'est
//             pour reparer une faute de saisie, pas pour acter un changement.
//
// Les periodes fermees sont immuables. Un bulletin de paie a pu etre edite en
// s'appuyant dessus : les modifier apres coup rendrait la comptabilite
// incoherente avec les recus deja remis aux employes.
// -----------------------------------------------------------------------------

class PeriodeFermeeError extends Error {
  constructor() {
    super(
      'Cette periode de carriere est cloturee et ne peut plus etre modifiee. '
      + "Des bulletins de paie ont pu etre etablis sur cette base. Pour acter un "
      + 'changement, ajoutez une nouvelle periode.'
    );
    this.name = 'PeriodeFermeeError';
    this.code = 'PERIODE_FERMEE';
  }
}

class DateCarriereError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DateCarriereError';
    this.code = 'DATE_INVALIDE';
  }
}

/** Periode de carriere en cours (celle qui n'a pas de date de fin). */
async function carriereCourante(client, employeId) {
  const { rows } = await client.query(
    'SELECT * FROM employes_carriere WHERE employe_id = $1 AND date_fin IS NULL',
    [employeId]
  );
  return rows[0] || null;
}

/** Historique complet, du plus recent au plus ancien. */
async function historiqueCarriere(client, employeId) {
  const { rows } = await client.query(
    `SELECT c.*, u.nom_utilisateur AS auteur
       FROM employes_carriere c
       LEFT JOIN utilisateurs u ON u.id = c.auteur_id
      WHERE c.employe_id = $1
      ORDER BY c.date_debut DESC, c.id DESC`,
    [employeId]
  );
  return rows;
}

/**
 * Resout une fonction depuis son identifiant et renvoie le couple (id, libelle).
 *
 * Le libelle est recopie dans la periode a cote de la reference : renommer une
 * fonction plus tard ne doit pas reecrire les bulletins deja edites.
 */
async function resoudreFonction(client, fonctionId) {
  if (!fonctionId) return null;
  const { rows } = await client.query('SELECT id, nom, actif FROM fonctions WHERE id = $1', [fonctionId]);
  return rows[0] || null;
}

/**
 * Ouvre une nouvelle periode de carriere et ferme la precedente.
 *
 * `fonctionId` est facultatif : la garder inchangee est le cas courant d'une
 * simple augmentation. On reprend alors celle de la periode qui se termine.
 */
async function ajouterPeriode(client, { employeId, montant, fonctionId, fonction, dateDebut, motif, auteurId }) {
  const debut = dateDebut || new Date().toISOString().slice(0, 10);
  const courante = await carriereCourante(client, employeId);

  // La fonction vient de la table de reference. Le libelle libre n'est accepte
  // qu'en repli, pour les periodes reprises d'avant la migration.
  const reference = await resoudreFonction(client, fonctionId);
  const libelle = reference?.nom || fonction || courante?.fonction || 'Non precisee';
  const identifiant = reference?.id ?? (fonctionId ? null : courante?.fonction_id ?? null);

  if (courante) {
    // Une nouvelle periode qui commencerait avant ou le jour meme du debut de
    // l'actuelle produirait deux periodes se chevauchant, donc un salaire
    // ambigu a la date de recouvrement.
    if (debut <= courante.date_debut) {
      throw new DateCarriereError(
        `La nouvelle periode doit commencer apres le ${courante.date_debut}, `
        + 'date de debut de la periode en cours.'
      );
    }
    // La periode precedente se termine la veille : deux periodes ne partagent
    // jamais un jour, sinon la paie du jour de bascule serait comptee deux fois.
    await client.query(
      "UPDATE employes_carriere SET date_fin = ($1::date - INTERVAL '1 day')::date WHERE id = $2",
      [debut, courante.id]
    );
  }

  const { rows } = await client.query(
    `INSERT INTO employes_carriere (employe_id, montant, fonction, fonction_id, date_debut, motif, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [employeId, montant, libelle, identifiant, debut, motif || null, auteurId]
  );

  await logAudit(client, {
    typeOperation: 'employe_carriere_ajout',
    entiteId: employeId,
    utilisateurId: auteurId,
    details: { motif: motif || null, date_debut: debut },
    avant: courante ? { montant: courante.montant, fonction: courante.fonction } : null,
    apres: { montant: rows[0].montant, fonction: rows[0].fonction },
  });

  return rows[0];
}

/** Rectifie la periode en cours. Refuse toute periode deja fermee. */
async function corrigerPeriode(client, { periodeId, montant, fonctionId, fonction, motif, auteurId }) {
  const { rows: existantes } = await client.query(
    'SELECT * FROM employes_carriere WHERE id = $1',
    [periodeId]
  );
  const periode = existantes[0];
  if (!periode) return null;
  if (periode.date_fin !== null) throw new PeriodeFermeeError();

  const reference = await resoudreFonction(client, fonctionId);

  const { rows } = await client.query(
    `UPDATE employes_carriere
        SET montant = COALESCE($1, montant),
            fonction = COALESCE($2, fonction),
            fonction_id = COALESCE($3, fonction_id),
            motif = COALESCE($4, motif)
      WHERE id = $5 RETURNING *`,
    [montant ?? null, reference?.nom || fonction || null, reference?.id ?? null, motif || null, periodeId]
  );

  await logAudit(client, {
    typeOperation: 'employe_carriere_correction',
    entiteId: periode.employe_id,
    utilisateurId: auteurId,
    details: { motif: motif || null },
    avant: { montant: periode.montant, fonction: periode.fonction },
    apres: { montant: rows[0].montant, fonction: rows[0].fonction },
  });

  return rows[0];
}

/**
 * Salaire applicable a une date donnee.
 *
 * Utilise par la paie : un cycle qui porte sur juillet doit retenir le salaire
 * en vigueur en juillet, pas celui d'aujourd'hui. Sans cela, creer un cycle
 * retroactif apres une augmentation surpayerait tout le monde.
 */
async function salaireALaDate(client, employeId, date) {
  const { rows } = await client.query(
    `SELECT * FROM employes_carriere
      WHERE employe_id = $1
        AND date_debut <= $2
        AND (date_fin IS NULL OR date_fin >= $2)
      ORDER BY date_debut DESC LIMIT 1`,
    [employeId, date]
  );
  return rows[0] || null;
}

module.exports = {
  carriereCourante,
  resoudreFonction,
  historiqueCarriere,
  ajouterPeriode,
  corrigerPeriode,
  salaireALaDate,
  PeriodeFermeeError,
  DateCarriereError,
};
