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
const { amorcerDemonstration } = require('./db/amorcage-demo');
const { appliquerEnrichissements } = require('./db/enrichissements');

// multer ecrit dans ces dossiers sans les creer. Ils sont versionnes, donc
// presents apres un deploiement ; mais un disque persistant monte sur
// backend/uploads masque le contenu du depot et arrive vide, ce qui ferait
// echouer tout envoi de photo avec un ENOENT.
function preparerDossiersUploads() {
  for (const sousDossier of ['produits', 'logo', 'employes', 'documents']) {
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

  // Avant l'ecoute, comme les migrations : une notion ajoutee par une mise a
  // jour doit etre renseignee sur les donnees existantes AVANT que l'API ne les
  // serve, sans quoi le premier ecran affiche un catalogue a moitie classe.
  // Ces traitements doivent donc rester courts - le remplissage long, c'est
  // l'amorcage ci-dessous, et il tourne apres l'ouverture du port.
  await appliquerEnrichissements();

  app.listen(config.port, () => {
    console.log(`MACHIBEL backend en ecoute sur le port ${config.port} (${config.env})`);
  });

  // Volontairement APRES l'ouverture du port, et sans `await`.
  //
  // Le premier remplissage prend plusieurs minutes. Le faire avant l'ecoute,
  // c'est un hebergeur qui n'obtient pas de reponse a sa sonde de sante,
  // declare le deploiement en echec et redemarre le service - qui recommence
  // depuis le debut, indefiniment.
  //
  // Une fois la base amorcee, ce passage ne fait plus qu'une lecture et la
  // remise en place des photos : quelques millisecondes.
  //
  // Les enrichissements repassent derriere : sur une base vide, ils n'avaient
  // rien a traiter tout a l'heure et ne se sont pas inscrits. Le catalogue
  // vient d'arriver, c'est maintenant qu'ils s'appliquent.
  amorcerDemonstration()
    .then(() => appliquerEnrichissements())
    .catch(() => {});
}

demarrer().catch(async (err) => {
  // Aucune ecoute n'est ouverte si on arrive ici : le service s'arrete avec un
  // code non nul, ce que NSSM signale au lieu de laisser tourner un backend
  // branche sur un schema incomplet.
  console.error(`\n[MACHIBEL] Demarrage impossible : ${err.message}\n`);
  await pool.end().catch(() => {});
  process.exit(1);
});
