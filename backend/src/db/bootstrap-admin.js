const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { logAudit } = require('./audit');

// -----------------------------------------------------------------------------
// Premier compte administrateur, cree automatiquement au tout premier demarrage
// du backend (voir server.js) si la table utilisateurs ne contient aucun admin.
//
// Identifiants VOLONTAIREMENT statiques : ils doivent etre connus a l'avance
// pour pouvoir ouvrir le systeme chez le client sans intervention. Ils sont
// donc, par construction, publics pour quiconque lit ce fichier.
//
// >>> A CHANGER DES LA PREMIERE CONNEXION, depuis l'ecran Parametres. <<<
//
// Aux demarrages suivants, ce script ne fait rien : des qu'un admin existe,
// il rend la main immediatement. Changer le mot de passe ici APRES la mise en
// service n'a donc aucun effet sur une base deja initialisee.
// -----------------------------------------------------------------------------
const ADMIN_IDENTIFIANT = 'admin';
const ADMIN_PRENOM = 'Administrateur';
const ADMIN_NOM = 'MACHIBEL';
const ADMIN_MOT_DE_PASSE = 'Machibel@2026';

// Verrou distinct de celui des migrations : deux demarrages simultanes ne
// doivent pas creer deux fois le compte (la contrainte UNIQUE sur l'email
// rattraperait le coup, mais avec une erreur au demarrage plutot qu'un no-op).
const VERROU_BOOTSTRAP = 481524;

const BANDEAU = '='.repeat(64);

/**
 * Cree le premier administrateur si aucun n'existe. Idempotent.
 * Retourne { cree: false } si un admin etait deja present.
 */
async function bootstrapAdmin({ logger = console } = {}) {
  const client = await pool.connect();
  let verrouPris = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [VERROU_BOOTSTRAP]);
    verrouPris = true;

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM utilisateurs WHERE role = 'admin'"
    );
    if (rows[0].n > 0) {
      return { cree: false };
    }

    const passwordHash = await bcrypt.hash(ADMIN_MOT_DE_PASSE, 10);

    await client.query('BEGIN');
    try {
      const { rows: adminRows } = await client.query(
        `INSERT INTO utilisateurs (prenom, nom, nom_utilisateur, password_hash, role)
         VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [ADMIN_PRENOM, ADMIN_NOM, ADMIN_IDENTIFIANT, passwordHash]
      );
      const adminId = adminRows[0].id;

      await logAudit(client, {
        typeOperation: 'admin_initial_cree',
        entiteId: adminId,
        utilisateurId: adminId,
        details: { nom_utilisateur: ADMIN_IDENTIFIANT, origine: 'bootstrap_premier_demarrage' },
      });

      await client.query('COMMIT');

      logger.log(
        `\n${BANDEAU}\n` +
        '  PREMIER COMPTE ADMINISTRATEUR CREE\n' +
        `${BANDEAU}\n` +
        `  Identifiant  : ${ADMIN_IDENTIFIANT}\n` +
        `  Mot de passe : ${ADMIN_MOT_DE_PASSE}\n` +
        `${'-'.repeat(64)}\n` +
        '  A CHANGER des la premiere connexion (ecran Parametres).\n' +
        `${BANDEAU}\n`
      );

      return { cree: true, id: adminId, identifiant: ADMIN_IDENTIFIANT };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    if (verrouPris) {
      await client.query('SELECT pg_advisory_unlock($1)', [VERROU_BOOTSTRAP]).catch(() => {});
    }
    client.release();
  }
}

module.exports = { bootstrapAdmin, ADMIN_IDENTIFIANT };
