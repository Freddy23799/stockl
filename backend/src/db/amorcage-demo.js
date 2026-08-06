const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const config = require('../config');
const { LOT } = require('../../scripts/lib/photos');

// -----------------------------------------------------------------------------
// Amorcage du jeu de demonstration au demarrage du serveur.
//
// Le remplissage existait deja en ligne de commande (`npm run seed-demo`), mais
// il n'etait jouable que depuis un poste ayant acces a la base. Sur un
// hebergement gere, on ne dispose pas d'un terminal sur le service : la base
// restait vide, et l'application en ligne montrait un systeme neuf alors que le
// travail attendu etait un historique de deux ans et demi.
//
// Ce module fait donc jouer le remplissage par le serveur lui-meme, une fois,
// au premier demarrage sur une base vide - exactement comme les migrations
// posent le schema.
//
// Trois garde-fous, parce qu'un remplissage commence par tout effacer :
//
//   1. il ne s'execute que si les tables metier sont TOUTES vides. Une base qui
//      porte le moindre produit ou la moindre vente n'est jamais touchee ;
//   2. l'issue est inscrite dans la table `amorcages`, donc il ne se rejoue
//      pas au redeploiement suivant, meme si la base a ete videe depuis ;
//   3. un verrou consultatif empeche deux instances demarrant en meme temps de
//      le lancer toutes les deux.
//
// Il reste entierement transactionnel : coupe en cours de route - ce qui arrive
// sur un hebergement gratuit qui met le service en veille - il ne laisse rien
// derriere lui et sera simplement retente au demarrage suivant.
// -----------------------------------------------------------------------------

const NOM = 'demonstration-2024-2026';

// Distinct de celui des migrations : les deux ne doivent pas s'attendre l'un
// l'autre, ils ne protegent pas la meme chose.
const VERROU = 481524;

// Tables dont le contenu signifie "cette base sert deja a quelque chose".
// `utilisateurs` et `parametres` en sont volontairement absentes : elles sont
// remplies par le demarrage lui-meme (compte administrateur, reglages par
// defaut) et seraient toujours non vides. `historique_audit` non plus : une
// simple connexion y laisse une trace, ce qui bloquerait le remplissage d'une
// base par ailleurs neuve.
const TABLES_METIER = ['produits', 'ventes', 'employes', 'fournisseurs', 'vendeuses', 'depenses'];

/**
 * Reglage facultatif, absent en fonctionnement normal :
 *   non     n'amorce jamais rien (base de developpement qu'on veut garder vide)
 *   forcer  amorce meme si la base contient deja des donnees - DESTRUCTIF
 */
const REGLAGE = (process.env.AMORCAGE_DEMO || '').trim().toLowerCase();

/**
 * Repose les photos du jeu de demonstration manquantes dans uploads/.
 *
 * L'hebergement gratuit n'offre pas de disque persistant : tout ce qui a ete
 * ecrit dans uploads/ disparait a chaque redemarrage. Le remplissage, lui, ne
 * se rejoue pas. Sans cette reprise, les fiches perdraient definitivement leurs
 * photos au premier reveil du service, et rien ne le signalerait.
 *
 * Les fichiers reellement televerses par l'utilisateur ne sont pas concernes :
 * eux sont perdus pour de bon, et c'est une limite de l'hebergement, pas
 * quelque chose que ce module puisse rattraper.
 */
function restaurerPhotos(photos, logger) {
  if (!photos) return { reposees: 0, absentes: 0 };
  let reposees = 0;
  let absentes = 0;

  for (const [relatif, cle] of Object.entries(photos)) {
    // Les chemins sont stockes en base sous la forme "uploads/produits/x.jpg".
    const destination = path.join(config.uploadsDir, relatif.replace(/^uploads[/\\]/, ''));
    if (fs.existsSync(destination)) continue;

    const source = path.join(LOT, `${cle}.jpg`);
    if (!fs.existsSync(source)) { absentes += 1; continue; }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    reposees += 1;
  }

  if (reposees) logger.log(`  ${reposees} photo(s) de demonstration reposees dans uploads/`);
  if (absentes) logger.log(`  ${absentes} photo(s) introuvables dans le lot versionne`);
  return { reposees, absentes };
}

async function lireEtat(client) {
  // La table n'existe pas si les migrations n'ont pas encore ete jouees : dans
  // ce cas il n'y a rien a lire, et surtout rien a amorcer.
  const { rows } = await client.query(
    `SELECT nom, etat, resume FROM amorcages WHERE nom = $1`,
    [NOM]
  );
  return rows[0] || null;
}

async function comptesMetier(client) {
  const selections = TABLES_METIER.map((t) => `(SELECT count(*) FROM ${t}) AS ${t}`);
  const { rows } = await client.query(`SELECT ${selections.join(', ')}`);
  return rows[0];
}

async function inscrire(client, etat, resume) {
  await client.query(
    `INSERT INTO amorcages (nom, etat, resume) VALUES ($1, $2, $3)
     ON CONFLICT (nom) DO UPDATE SET etat = EXCLUDED.etat,
                                     resume = EXCLUDED.resume,
                                     applique_le = now()`,
    [NOM, etat, JSON.stringify(resume)]
  );
}

/**
 * Point d'entree, appele apres les migrations et le compte administrateur.
 * Ne jette jamais : un remplissage de demonstration qui echoue ne doit pas
 * empecher l'application de servir.
 *
 * @returns {{ etat: string, raison?: string }}
 */
async function amorcerDemonstration({ logger = console } = {}) {
  if (REGLAGE === 'non') return { etat: 'desactive' };

  const client = await pool.connect();
  let verrouPris = false;

  try {
    const { rows: [verrou] } = await client.query('SELECT pg_try_advisory_lock($1) AS pris', [VERROU]);
    if (!verrou.pris) {
      // Une autre instance s'en occupe. Ne pas attendre : elle en a pour
      // plusieurs minutes, et ce serveur-ci doit repondre pendant ce temps.
      return { etat: 'en-cours-ailleurs' };
    }
    verrouPris = true;

    const dejaFait = await lireEtat(client);
    if (dejaFait && REGLAGE !== 'forcer') {
      if (dejaFait.etat === 'applique') restaurerPhotos(dejaFait.resume?.photos, logger);
      return { etat: dejaFait.etat, raison: 'deja decide' };
    }

    const comptes = await comptesMetier(client);
    const occupees = Object.entries(comptes).filter(([, n]) => Number(n) > 0);

    if (occupees.length && REGLAGE !== 'forcer') {
      const detail = occupees.map(([t, n]) => `${t}=${n}`).join(', ');
      logger.log(
        `[MACHIBEL] Jeu de demonstration non pose : la base contient deja des donnees (${detail}).\n`
        + '           Rien n\'a ete efface. Pour le poser malgre tout, videz ces tables ou\n'
        + '           demarrez une fois avec AMORCAGE_DEMO=forcer (ceci efface les donnees existantes).'
      );
      await inscrire(client, 'ignore', { motif: 'base non vide', comptes });
      return { etat: 'ignore', raison: detail };
    }

    logger.log('[MACHIBEL] Base vide : mise en place du jeu de demonstration (quelques minutes)...');

    // Chargement tardif : ce module pese un millier de lignes et n'a aucune
    // raison d'etre analyse a chaque demarrage d'un serveur deja amorce.
    const { remplir } = require('../../scripts/seed-demo');
    const { manifeste, bilan, problemes } = await remplir();

    await inscrire(client, 'applique', { photos: manifeste, bilan, problemes });

    if (problemes.length) {
      logger.error(`[MACHIBEL] Jeu de demonstration pose, mais ${problemes.length} incoherence(s) relevee(s).`);
    } else {
      logger.log('[MACHIBEL] Jeu de demonstration en place et coherent.');
    }
    return { etat: 'applique', bilan };
  } catch (err) {
    // Volontairement non bloquant. L'application sait fonctionner sur une base
    // vide ; la priorite est qu'elle reponde.
    logger.error(`[MACHIBEL] Amorcage du jeu de demonstration abandonne : ${err.message}`);
    logger.error(err.stack);
    return { etat: 'echec', raison: err.message };
  } finally {
    if (verrouPris) {
      await client.query('SELECT pg_advisory_unlock($1)', [VERROU]).catch(() => {});
    }
    client.release();
  }
}

module.exports = { amorcerDemonstration, restaurerPhotos, NOM };

/* --- Execution manuelle : `npm run amorcer-demo` -------------------------- */

if (require.main === module) {
  amorcerDemonstration()
    .then((resultat) => {
      console.log(`Amorcage : ${resultat.etat}${resultat.raison ? ` (${resultat.raison})` : ''}`);
      return pool.end();
    })
    .catch(async () => {
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
