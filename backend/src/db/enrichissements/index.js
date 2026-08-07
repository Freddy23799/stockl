const pool = require('../../config/db');

// Verrou consultatif distinct de celui des migrations (481523) et de celui de
// l'amorcage (481524). Deux instances qui redemarrent en meme temps - c'est le
// cas courant d'un redeploiement sans coupure - ne doivent pas jouer le meme
// enrichissement en double.
const VERROU_ENRICHISSEMENTS = 481525;

/**
 * Registre, dans l'ordre d'application. Les entrees ne se reordonnent pas et ne
 * se modifient plus une fois livrees : une base qui a deja joue `001` ne
 * rejouera jamais le fichier, meme corrige. Un correctif se livre sous un
 * nouveau numero.
 */
const ENRICHISSEMENTS = [
  require('./001-rayons-produits'),
  require('./002-marques-demonstration'),
];

/**
 * Applique les enrichissements en attente.
 *
 * Chaque enrichissement s'execute dans sa propre transaction et doit etre
 * idempotent malgre l'enregistrement : le filet ne remplace pas la prudence,
 * une transaction validee mais dont l'enregistrement echoue laisserait le
 * traitement rejouable.
 *
 * `executer` renvoie soit un resume - le traitement a eu lieu, on l'inscrit -
 * soit `null` : rien a faire pour l'instant, on n'inscrit rien et on
 * reexaminera au demarrage suivant. C'est ce second cas qui permet a une base
 * vide au moment du demarrage de recevoir le traitement une fois amorcee.
 *
 * Ne jette jamais : un enrichissement rate est une donnee moins jolie, pas un
 * serveur qui refuse de demarrer.
 */
async function appliquerEnrichissements({ logger = console } = {}) {
  const client = await pool.connect();
  let verrouPris = false;
  const bilan = { appliques: [], reportes: [], echoues: [] };

  try {
    // try_ et non pg_advisory_lock : si une autre instance s'en occupe deja,
    // on passe notre chemin plutot que d'attendre la fin de son traitement.
    const { rows: verrou } = await client.query('SELECT pg_try_advisory_lock($1) AS pris', [VERROU_ENRICHISSEMENTS]);
    if (!verrou[0].pris) return bilan;
    verrouPris = true;

    const { rows } = await client.query('SELECT nom FROM enrichissements');
    const dejaJoues = new Set(rows.map((r) => r.nom));

    for (const enrichissement of ENRICHISSEMENTS) {
      const { nom } = enrichissement;
      if (dejaJoues.has(nom)) continue;

      await client.query('BEGIN');
      try {
        const resume = await enrichissement.executer(client, logger);

        if (!resume) {
          await client.query('ROLLBACK');
          bilan.reportes.push(nom);
          continue;
        }

        await client.query(
          'INSERT INTO enrichissements (nom, resume) VALUES ($1, $2) ON CONFLICT (nom) DO NOTHING',
          [nom, JSON.stringify(resume)]
        );
        await client.query('COMMIT');
        bilan.appliques.push(nom);
        logger.log(`  enrichissement applique : ${nom} ${JSON.stringify(resume)}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        bilan.echoues.push(nom);
        logger.error(`  enrichissement ${nom} echoue : ${err.message}`);
      }
    }

    return bilan;
  } catch (err) {
    logger.error(`[enrichissements] ${err.message}`);
    return bilan;
  } finally {
    if (verrouPris) {
      await client.query('SELECT pg_advisory_unlock($1)', [VERROU_ENRICHISSEMENTS]).catch(() => {});
    }
    client.release();
  }
}

module.exports = { appliquerEnrichissements };
