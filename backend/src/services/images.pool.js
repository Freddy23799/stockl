const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

// -----------------------------------------------------------------------------
// Petit vivier de fils d'execution pour le traitement d'image.
//
// Les fils sont crees a la premiere demande, pas au demarrage : sur une
// installation ou personne n'envoie jamais de photo, ils ne servent a rien et
// couteraient une trentaine de mega-octets de memoire pour rien. C'est le genre
// de detail qui compte sur un hebergement a 512 Mo.
//
// Deux fils suffisent largement : au dela, on se dispute les coeurs disponibles
// sans rien gagner, et le service tourne sur une machine partagee.
// -----------------------------------------------------------------------------

const TAILLE_VIVIER = Math.max(1, Math.min(2, (os.cpus()?.length || 2) - 1));

// Un fil inactif est arrete : on ne garde pas de la memoire occupee entre deux
// envois espaces de plusieurs heures.
const INACTIVITE_MS = 60_000;

const CHEMIN_WORKER = path.join(__dirname, 'images.worker.js');

let fils = [];
let prochainId = 1;
const enAttente = new Map();
const file = [];
let minuteurInactivite = null;

function creerFil() {
  const worker = new Worker(CHEMIN_WORKER);
  const etat = { worker, occupe: false };

  worker.on('message', ({ id, resultat }) => {
    const promesse = enAttente.get(id);
    enAttente.delete(id);
    etat.occupe = false;
    promesse?.resoudre(resultat);
    depiler();
  });

  // Un fil qui meurt ne doit pas laisser des promesses suspendues pour
  // toujours : l'envoi echouerait sans jamais repondre.
  worker.on('error', (err) => {
    etat.occupe = false;
    for (const [id, promesse] of enAttente) {
      if (promesse.fil === etat) {
        enAttente.delete(id);
        promesse.rejeter(err);
      }
    }
    fils = fils.filter((f) => f !== etat);
    depiler();
  });

  worker.on('exit', () => {
    fils = fils.filter((f) => f !== etat);
  });

  worker.unref();
  fils.push(etat);
  return etat;
}

function programmerArret() {
  clearTimeout(minuteurInactivite);
  minuteurInactivite = setTimeout(() => {
    if (file.length === 0 && enAttente.size === 0) {
      for (const f of fils) f.worker.terminate().catch(() => {});
      fils = [];
    }
  }, INACTIVITE_MS);
  minuteurInactivite.unref?.();
}

function depiler() {
  if (!file.length) {
    programmerArret();
    return;
  }
  let libre = fils.find((f) => !f.occupe);
  if (!libre && fils.length < TAILLE_VIVIER) libre = creerFil();
  if (!libre) return;

  const { tache, resoudre, rejeter } = file.shift();
  const id = prochainId += 1;
  libre.occupe = true;
  enAttente.set(id, { resoudre, rejeter, fil: libre });
  libre.worker.postMessage({ id, tache });
}

/**
 * Traite un fichier image hors du fil principal.
 * @returns {Promise<{tailleOrigine:number, tailleFinale:number, chemin:string, optimise:boolean}>}
 */
function traiterImage(tache) {
  return new Promise((resoudre, rejeter) => {
    file.push({ tache, resoudre, rejeter });
    depiler();
  });
}

module.exports = { traiterImage, TAILLE_VIVIER };
