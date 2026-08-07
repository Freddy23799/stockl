const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const config = require('../config');

// Logo livre avec le depot. Il sert de filet quand `logo_path` designe un
// fichier disparu dont la base n'a pas de copie - le cas des logos envoyes
// avant que la copie en base n'existe.
const DEFAUT = 'uploads/logo/logo-machibel-default.png';

function chemin(relatif) {
  return path.join(config.uploadsDir, String(relatif).replace(/^uploads[/\\]/, ''));
}

/**
 * Remet le logo de l'etablissement en place dans `uploads/`.
 *
 * A chaque demarrage, et non une seule fois : sur un hebergement sans disque
 * persistant, `uploads/` est vide a chaque reveil du service. C'est le meme
 * traitement que la remise en place des photos de demonstration, mais pour un
 * fichier qui vient de l'exploitant et ne peut donc etre versionne nulle part.
 *
 * Ne jette jamais : un logo manquant est un en-tete moins joli, pas un serveur
 * qui refuse de demarrer.
 */
async function restaurerLogo({ logger = console } = {}) {
  try {
    const { rows } = await pool.query(
      'SELECT logo_path, logo_donnees, logo_type FROM parametres WHERE id = 1'
    );
    const parametres = rows[0];
    if (!parametres || !parametres.logo_path) return { etat: 'sans-logo' };

    const destination = chemin(parametres.logo_path);
    if (fs.existsSync(destination)) return { etat: 'en-place' };

    if (parametres.logo_donnees) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, parametres.logo_donnees);
      logger.log(`  logo repose dans uploads/ (${parametres.logo_donnees.length} octets)`);
      return { etat: 'repose' };
    }

    // Le fichier a disparu et la base n'en a pas de copie. Laisser `logo_path`
    // pointer dans le vide, c'est un 404 sur l'en-tete de l'application et un
    // logo absent de tous les PDF, sans que rien ne le signale. On revient au
    // logo livre avec le depot : l'exploitant n'a qu'a renvoyer le sien.
    if (parametres.logo_path !== DEFAUT && fs.existsSync(chemin(DEFAUT))) {
      await pool.query('UPDATE parametres SET logo_path = $1 WHERE id = 1', [DEFAUT]);
      logger.log(
        `[MACHIBEL] Logo introuvable (${parametres.logo_path}) et absent de la base : `
        + 'retour au logo par defaut. Renvoyez le votre depuis Parametres, il sera '
        + 'desormais conserve en base et survivra aux redemarrages.'
      );
      return { etat: 'defaut' };
    }

    return { etat: 'introuvable' };
  } catch (err) {
    logger.error(`[MACHIBEL] Remise en place du logo abandonnee : ${err.message}`);
    return { etat: 'echec', raison: err.message };
  }
}

module.exports = { restaurerLogo, DEFAUT };
