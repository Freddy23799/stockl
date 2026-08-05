// La config valide DB_PASSWORD et JWT_SECRET au chargement et jette si l'un des
// deux manque. On l'attrape ici pour afficher un message lisible dans le journal
// du service Windows plutot qu'une stack trace.
let config;
try {
  config = require('./config');
} catch (err) {
  console.error(`\n[MACHIBEL] Demarrage impossible : ${err.message}\n`);
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const app = require('./app');
const pool = require('./config/db');
const { runMigrations } = require('./db/migrate');
const { bootstrapAdmin } = require('./db/bootstrap-admin');

// multer ecrit dans ces dossiers sans les creer. Ils sont versionnes, donc
// presents apres un deploiement ; mais un disque persistant monte sur
// backend/uploads masque le contenu du depot et arrive vide, ce qui ferait
// echouer tout envoi de photo avec un ENOENT.
function preparerDossiersUploads() {
  for (const sousDossier of ['produits', 'logo']) {
    fs.mkdirSync(path.join(config.uploadsDir, sousDossier), { recursive: true });
  }
}

// Sequence de demarrage : schema a jour, puis compte admin, puis ecoute.
// Tout est idempotent - un redemarrage ordinaire ne fait rien de plus que
// verifier que les deux sont deja en place.
async function demarrer() {
  preparerDossiersUploads();
  await runMigrations();
  await bootstrapAdmin();

  app.listen(config.port, () => {
    console.log(`MACHIBEL backend en ecoute sur le port ${config.port} (${config.env})`);
  });
}

demarrer().catch(async (err) => {
  // Aucune ecoute n'est ouverte si on arrive ici : le service s'arrete avec un
  // code non nul, ce que NSSM signale au lieu de laisser tourner un backend
  // branche sur un schema incomplet.
  console.error(`\n[MACHIBEL] Demarrage impossible : ${err.message}\n`);
  await pool.end().catch(() => {});
  process.exit(1);
});
