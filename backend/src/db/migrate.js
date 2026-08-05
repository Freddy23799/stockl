const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Verrou consultatif PostgreSQL. Le service Windows peut etre redemarre pendant
// qu'un `npm run migrate` manuel tourne encore : sans ce verrou, les deux
// appliqueraient la meme migration en parallele.
const VERROU_MIGRATIONS = 481523;

function empreinte(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

/**
 * Applique les migrations en attente, dans l'ordre alphabetique des fichiers.
 * Chaque migration passe dans sa propre transaction : une migration qui echoue
 * est annulee entierement et les suivantes ne sont pas tentees.
 *
 * Appelable au demarrage du serveur (voir server.js) ou en ligne de commande
 * (`npm run migrate`). Ne ferme jamais le pool : c'est a l'appelant de decider.
 */
async function runMigrations({ logger = console } = {}) {
  const client = await pool.connect();
  let verrouPris = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [VERROU_MIGRATIONS]);
    verrouPris = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Ajoutee apres coup : les bases deja migrees n'ont pas cette colonne.
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)');

    const { rows } = await client.query('SELECT name, checksum FROM schema_migrations');
    const dejaAppliquees = new Map(rows.map((r) => [r.name, r.checksum]));

    const fichiers = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliquees = [];

    for (const fichier of fichiers) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, fichier), 'utf8');
      const somme = empreinte(sql);

      if (dejaAppliquees.has(fichier)) {
        const sommeEnregistree = dejaAppliquees.get(fichier);
        // Une migration deja jouee ne doit plus jamais bouger : la base du client
        // ne verrait pas la modification et divergerait silencieusement du code.
        if (sommeEnregistree && sommeEnregistree !== somme) {
          throw new Error(
            `la migration ${fichier} a ete modifiee apres avoir ete appliquee. ` +
            'Une migration deja jouee ne doit jamais etre editee : creez un nouveau ' +
            'fichier de migration a la place.'
          );
        }
        // Base migree avant l'ajout des empreintes : on l'enregistre sans rien rejouer.
        if (!sommeEnregistree) {
          await client.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', [somme, fichier]);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [fichier, somme]
        );
        await client.query('COMMIT');
        appliquees.push(fichier);
        logger.log(`  migration appliquee : ${fichier}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${fichier} echouee : ${err.message}`);
      }
    }

    return { appliquees, total: fichiers.length };
  } finally {
    if (verrouPris) {
      await client.query('SELECT pg_advisory_unlock($1)', [VERROU_MIGRATIONS]).catch(() => {});
    }
    client.release();
  }
}

module.exports = { runMigrations };

// Execution directe : `npm run migrate`
if (require.main === module) {
  runMigrations()
    .then(({ appliquees, total }) => {
      console.log(
        appliquees.length === 0
          ? `Schema a jour (${total} migration(s), aucune en attente).`
          : `${appliquees.length} migration(s) appliquee(s) sur ${total}.`
      );
      return pool.end();
    })
    .catch(async (err) => {
      console.error(`Echec des migrations : ${err.message}`);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
