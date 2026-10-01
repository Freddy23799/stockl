const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { logAudit } = require('./audit');

// -----------------------------------------------------------------------------
// Premier compte OPERATEUR PLATEFORME, cree automatiquement au tout premier
// demarrage si aucun n'existe. Meme logique que bootstrap-admin.js, pour le
// compte qui gere les entreprises clientes plutot qu'une boutique precise.
//
// Identifiants VOLONTAIREMENT statiques, pour la meme raison que l'admin
// MACHIBEL : ils doivent etre connus a l'avance pour ouvrir le systeme sans
// intervention manuelle en base.
//
// >>> A CHANGER DES LA PREMIERE CONNEXION. <<<
// -----------------------------------------------------------------------------
const OPERATEUR_IDENTIFIANT = 'operateur';
const OPERATEUR_PRENOM = 'Operateur';
const OPERATEUR_NOM = 'Plateforme';
const OPERATEUR_MOT_DE_PASSE = 'operateur123';

const VERROU_BOOTSTRAP_OPERATEUR = 481525;

const BANDEAU = '='.repeat(64);

/**
 * Cree le premier operateur plateforme si aucun n'existe. Idempotent.
 */
async function bootstrapOperateur({ logger = console } = {}) {
  const client = await pool.connect();
  let verrouPris = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [VERROU_BOOTSTRAP_OPERATEUR]);
    verrouPris = true;

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM utilisateurs WHERE role = 'operateur'"
    );
    if (rows[0].n > 0) {
      return { cree: false };
    }

    const passwordHash = await bcrypt.hash(OPERATEUR_MOT_DE_PASSE, 10);

    await client.query('BEGIN');
    try {
      const { rows: operateurRows } = await client.query(
        `INSERT INTO utilisateurs (prenom, nom, nom_utilisateur, password_hash, role, entreprise_id)
         VALUES ($1, $2, $3, $4, 'operateur', NULL) RETURNING id`,
        [OPERATEUR_PRENOM, OPERATEUR_NOM, OPERATEUR_IDENTIFIANT, passwordHash]
      );
      const operateurId = operateurRows[0].id;

      await logAudit(client, {
        typeOperation: 'operateur_initial_cree',
        entiteId: operateurId,
        utilisateurId: operateurId,
        details: { nom_utilisateur: OPERATEUR_IDENTIFIANT, origine: 'bootstrap_premier_demarrage' },
      });

      await client.query('COMMIT');

      logger.log(
        `\n${BANDEAU}\n` +
        '  PREMIER COMPTE OPERATEUR PLATEFORME CREE\n' +
        `${BANDEAU}\n` +
        `  Identifiant  : ${OPERATEUR_IDENTIFIANT}\n` +
        `  Mot de passe : ${OPERATEUR_MOT_DE_PASSE}\n` +
        `${'-'.repeat(64)}\n` +
        '  A CHANGER des la premiere connexion.\n' +
        `${BANDEAU}\n`
      );

      return { cree: true, id: operateurId, identifiant: OPERATEUR_IDENTIFIANT };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    if (verrouPris) {
      await client.query('SELECT pg_advisory_unlock($1)', [VERROU_BOOTSTRAP_OPERATEUR]).catch(() => {});
    }
    client.release();
  }
}

module.exports = { bootstrapOperateur, OPERATEUR_IDENTIFIANT };
