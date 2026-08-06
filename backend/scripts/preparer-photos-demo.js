// -----------------------------------------------------------------------------
// Constitution du lot d'images du jeu de demonstration.
//
// A lancer une seule fois, sur un poste de developpement : le resultat part
// dans le depot et c'est lui qui sert ensuite, en ligne comme en local.
//
//     npm run preparer-photos-demo
//
// Pourquoi versionner des images plutot que les telecharger au besoin :
//
//  - le remplissage se joue au demarrage du serveur en ligne. Dependre a cet
//    instant de deux services publics d'images, pour deux cent soixante
//    requetes, c'est accepter qu'un deploiement produise un catalogue sans
//    photos parce qu'un tiers etait en limitation de debit ;
//  - l'hebergement gratuit n'a pas de disque persistant. Le contenu de
//    uploads/ dispararait a chaque redemarrage, et le remplissage, lui, ne se
//    rejoue pas. Sans une source presente dans le depot, les fiches perdraient
//    definitivement leurs photos au premier reveil du service.
//
// Les images sont reduites ici, une fois pour toutes, pour ne pas alourdir le
// depot ni le temps de clonage a chaque deploiement.
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const { obtenirLot, demandesPhotosDemo, LOT } = require('./lib/photos');

const octets = (n) => `${(n / 1024 / 1024).toFixed(1)} Mo`;

async function principal() {
  const demandes = demandesPhotosDemo();
  console.log(`${demandes.length} images a preparer.`);

  // Constitution incrementale : `obtenirLot` regarde d'abord dans le lot, donc
  // ce qui y est deja ne repart pas sur le reseau.
  //
  // C'est necessaire, pas seulement confortable : sur deux cent soixante
  // demandes, les services d'images en refusent regulierement quelques dizaines
  // malgre les reprises. Relancer la commande complete alors le lot au lieu de
  // tout redemander - et de perdre a nouveau une autre poignee d'images.
  //
  // Pour repartir vraiment de zero (changement des dimensions demandees),
  // supprimer backend/seed-assets/photos et backend/.cache-photos a la main :
  // les deux sont indexes par cle, pas par URL, et ne verraient pas le
  // changement.
  fs.mkdirSync(LOT, { recursive: true });
  const dejaLa = fs.readdirSync(LOT).length;
  if (dejaLa) console.log(`${dejaLa} deja presentes dans le lot, seules les manquantes seront demandees.`);

  const sources = await obtenirLot(demandes, { journal: (m) => console.log(m) });

  // Une image qui n'est plus demandee n'a aucune raison de rester dans le depot.
  const attendues = new Set(demandes.map((d) => `${d.cle}.jpg`));
  for (const fichier of fs.readdirSync(LOT)) {
    if (!attendues.has(fichier)) fs.rmSync(path.join(LOT, fichier));
  }

  let poids = 0;
  let manquantes = 0;
  const parUsage = {};

  for (const { cle, usage } of demandes) {
    const source = sources.get(cle);
    if (!source) { manquantes += 1; continue; }

    // Copie telle quelle : les images arrivent deja aux dimensions voulues,
    // compressees par le service qui les a produites. Les repasser dans notre
    // encodeur les alourdirait.
    const destination = path.join(LOT, `${cle}.jpg`);
    fs.copyFileSync(source, destination);

    const taille = fs.statSync(destination).size;
    poids += taille;
    parUsage[usage] = parUsage[usage] || { nombre: 0, poids: 0 };
    parUsage[usage].nombre += 1;
    parUsage[usage].poids += taille;
  }

  console.log('--------------------------------------------------------');
  console.log(`  lot            ${LOT}`);
  console.log(`  images         ${fs.readdirSync(LOT).length}${manquantes ? ` (${manquantes} indisponibles)` : ''}`);
  for (const [usage, u] of Object.entries(parUsage)) {
    console.log(`  ${usage.padEnd(14)} ${String(u.nombre).padStart(3)} fichiers, ${octets(u.poids)}`
      + ` (${(u.poids / u.nombre / 1024).toFixed(0)} ko en moyenne)`);
  }
  console.log(`  total          ${octets(poids)}`);

  if (manquantes) process.exitCode = 1;
}

principal().catch((err) => {
  console.error(`\nEchec de la preparation : ${err.message}`);
  process.exit(1);
});
