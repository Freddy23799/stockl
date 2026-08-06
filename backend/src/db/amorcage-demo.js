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
 *
 *   non         n'amorce jamais rien (base de dev qu'on veut garder vide)
 *   completer   pose le jeu A COTE de ce qui existe, sans rien effacer
 *   forcer      pose le jeu APRES avoir tout efface - DESTRUCTIF
 *
 * Les deux derniers acceptent un suffixe (`completer-2`, `forcer-mars`) pour
 * agir une nouvelle fois plus tard : voir JETON_FORCAGE.
 */
const REGLAGE = (process.env.AMORCAGE_DEMO || '').trim().toLowerCase();

/**
 * Le forcage n'agit qu'UNE FOIS par valeur, et c'est essentiel.
 *
 * La variable se regle dans la console de l'hebergeur, ou elle reste en place
 * tant qu'on ne l'a pas retiree a la main. Si elle agissait a chaque lecture,
 * un service qui se met en veille toutes les quinze minutes rejouerait le
 * remplissage a chaque reveil - et effacerait le travail reel saisi entre
 * temps, indefiniment. Un oubli banal deviendrait une perte de donnees
 * quotidienne.
 *
 * La valeur employee est donc conservee dans le marqueur : la relire ne
 * declenche plus rien. Pour forcer a nouveau, on ecrit une valeur differente
 * (`forcer-2`), ce qui est un geste explicite et non un reliquat.
 */
const JETON_FORCAGE = (REGLAGE.startsWith('forcer') || REGLAGE.startsWith('completer'))
  ? REGLAGE
  : null;

// `completer` passe outre le garde-fou comme `forcer`, mais sans le TRUNCATE :
// ce qui a deja ete saisi reste en place et le jeu de demonstration vient a
// cote. C'est le bon reglage quand la base porte quelques fiches de test qu'on
// prefere garder.
const EFFACER = !REGLAGE.startsWith('completer');

function forcageNeuf(precedent) {
  return Boolean(JETON_FORCAGE) && JETON_FORCAGE !== (precedent?.resume?.forcage || null);
}

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

    const precedent = await lireEtat(client);
    const forcer = forcageNeuf(precedent);

    // `applique` est definitif : le jeu a bien ete pose. S'il a ete efface
    // depuis, c'est une decision, pas un accident - on ne le remet pas.
    if (precedent?.etat === 'applique' && !forcer) {
      restaurerPhotos(precedent.resume?.photos, logger);
      return { etat: 'applique', raison: 'deja pose' };
    }

    // `ignore` ne l'est pas. Il dit seulement que la base etait occupee ce
    // jour-la ; elle a pu etre videe depuis. On reevalue donc a chaque
    // demarrage, ce qui evite d'avoir a intervenir en base pour effacer un
    // refus devenu caduc.

    const comptes = await comptesMetier(client);
    const occupees = Object.entries(comptes).filter(([, n]) => Number(n) > 0);

    if (occupees.length && !forcer) {
      const detail = occupees.map(([t, n]) => `${t}=${n}`).join(', ');
      logger.log(
        `[MACHIBEL] Jeu de demonstration non pose : la base contient deja des donnees (${detail}).\n`
        + '           Rien n\'a ete efface. Pour le poser malgre tout, demarrez une fois avec\n'
        + '             AMORCAGE_DEMO=completer  pose le jeu a cote, sans rien effacer\n'
        + '             AMORCAGE_DEMO=forcer     efface tout d\'abord'
      );
      await inscrire(client, 'ignore', { motif: 'base non vide', comptes });
      return { etat: 'ignore', raison: detail };
    }

    if (!forcer) {
      logger.log('[MACHIBEL] Base vide : mise en place du jeu de demonstration (quelques minutes)...');
    } else {
      logger.log(
        `[MACHIBEL] AMORCAGE_DEMO=${JETON_FORCAGE} : remplissage ${EFFACER ? 'FORCE' : 'en complement'}, `
        + `les donnees existantes vont etre ${EFFACER ? 'EFFACEES' : 'conservees'}.\n`
        + '           Ce reglage n\'agira qu\'une fois : la variable peut rester en place sans danger.'
      );
    }

    // Chargement tardif : ce module pese un millier de lignes et n'a aucune
    // raison d'etre analyse a chaque demarrage d'un serveur deja amorce.
    const { remplir } = require('../../scripts/seed-demo');
    const { manifeste, bilan, problemes } = await remplir({ effacer: EFFACER });

    // Le jeton de forcage est conserve : c'est lui qui empeche la meme valeur
    // de tout reeffacer au prochain reveil du service.
    await inscrire(client, 'applique', { photos: manifeste, bilan, problemes, forcage: JETON_FORCAGE });

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
