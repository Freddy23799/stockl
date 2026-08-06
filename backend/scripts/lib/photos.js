const fs = require('fs');
const path = require('path');
const https = require('https');

// -----------------------------------------------------------------------------
// Recuperation des images du jeu de demonstration.
//
// Les photos sont telechargees une seule fois et mises en cache sur le disque :
// rejouer le remplissage ne doit pas redemander quatre-vingts images a des
// services publics, ni dependre de la connexion.
// -----------------------------------------------------------------------------

const CACHE = path.join(__dirname, '..', '..', '.cache-photos');

// Lot d'images versionne avec le code (voir scripts/preparer-photos-demo.js).
//
// En ligne, le remplissage se joue au demarrage du serveur : il ne peut pas
// dependre de services publics d'images qui peuvent etre lents, limites en
// debit ou indisponibles au moment precis du deploiement. Les images sont donc
// embarquees dans le depot, deja reduites, et le telechargement ne sert plus
// que de secours en developpement quand le lot n'a pas encore ete constitue.
const LOT = path.join(__dirname, '..', '..', 'seed-assets', 'photos');

/** Chemin d'une image du lot versionne, ou null si elle n'y est pas. */
function depuisLot(cle) {
  const chemin = path.join(LOT, `${cle}.jpg`);
  return fs.existsSync(chemin) ? chemin : null;
}

function telecharger(url, destination, redirections = 0) {
  return new Promise((resoudre, rejeter) => {
    if (redirections > 5) return rejeter(new Error('Trop de redirections'));

    const requete = https.get(url, { timeout: 20000 }, (reponse) => {
      // Ces services repondent en 302 vers l'image reelle : sans suivre la
      // redirection on enregistrerait une page vide.
      if (reponse.statusCode >= 300 && reponse.statusCode < 400 && reponse.headers.location) {
        reponse.resume();
        return resoudre(telecharger(reponse.headers.location, destination, redirections + 1));
      }
      if (reponse.statusCode !== 200) {
        reponse.resume();
        return rejeter(new Error(`HTTP ${reponse.statusCode} sur ${url}`));
      }

      const morceaux = [];
      reponse.on('data', (m) => morceaux.push(m));
      reponse.on('end', () => {
        const corps = Buffer.concat(morceaux);
        // Une reponse de quelques octets n'est pas une image : mieux vaut
        // echouer ici que d'ecrire un fichier illisible dans les uploads.
        if (corps.length < 1024) return rejeter(new Error(`Reponse trop courte (${corps.length} octets)`));
        fs.writeFileSync(destination, corps);
        resoudre(destination);
      });
      reponse.on('error', rejeter);
    });

    requete.on('timeout', () => { requete.destroy(new Error('Delai depasse')); });
    requete.on('error', rejeter);
  });
}

/**
 * Recupere une image, en la reprenant du cache si elle y est deja.
 * @param {string} cle  nom stable, sert de nom de fichier dans le cache
 */
async function obtenirImage(cle, url) {
  // Le lot versionne prime : c'est la seule source disponible a coup sur en
  // ligne, et elle contient deja des images reduites.
  const embarquee = depuisLot(cle);
  if (embarquee) return embarquee;

  fs.mkdirSync(CACHE, { recursive: true });
  const destination = path.join(CACHE, `${cle}.jpg`);
  if (fs.existsSync(destination) && fs.statSync(destination).size > 1024) return destination;
  await telecharger(url, destination);
  return destination;
}

// Portrait realiste. `randomuser.me` sert des photos de personnes libres de
// droit, indexees par numero : la meme cle redonne toujours le meme visage, ce
// qui garde le jeu de donnees stable d'une execution a l'autre.
function urlPortrait(sexe, index) {
  const genre = sexe === 'F' ? 'women' : 'men';
  return `https://randomuser.me/api/portraits/${genre}/${index % 99}.jpg`;
}

// Photo de produit ou de document. `picsum.photos` sert des cliches libres de
// droit ; la graine fixe garantit la meme image a chaque execution.
function urlPhoto(graine, largeur = 600, hauteur = 600) {
  return `https://picsum.photos/seed/${encodeURIComponent(graine)}/${largeur}/${hauteur}`;
}

// Dimensions demandees a la source, plutot qu'une reduction apres coup.
//
// Reencoder ces images ici ne servait a rien : l'encodeur JPEG en JavaScript
// pur rend des fichiers plus lourds que ceux du service d'origine a qualite
// egale, et le lot ne perdait que deux pour cent. Les demander directement a la
// bonne taille les fait passer de dix-huit a six mega-octets, sans aucune perte
// de qualite puisque c'est le service qui redimensionne et recompresse.
//
// Les valeurs sont choisies pour l'usage reel : une photo de produit s'affiche
// dans une fiche, une piece de dossier se lit a l'ecran. Personne n'ouvre l'une
// ni l'autre a la loupe.
const TAILLES = {
  produit: [420, 420],
  document: [500, 680],
};

const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Telecharge en parallele, mais par petits paquets : lancer quatre-vingts
 * requetes d'un coup fait tomber ces services publics en limitation de debit,
 * et on recupere alors des erreurs plutot que des images.
 *
 * Meme par paquets, une partie des demandes se fait refuser sur un lot de
 * plusieurs centaines - un premier passage en a perdu cent quatre. On reprend
 * donc les echecs, en espacant chaque tentative un peu plus : la limitation est
 * temporaire par nature, il suffit de lui laisser le temps de retomber.
 */
async function obtenirLot(demandes, { parallele = 4, tentatives = 4, journal = null } = {}) {
  const resultats = new Map();
  let restantes = demandes;

  for (let tentative = 1; tentative <= tentatives && restantes.length; tentative += 1) {
    if (tentative > 1) {
      const attente = 3000 * (tentative - 1);
      journal?.(`  ${restantes.length} image(s) a reprendre, nouvelle tentative dans ${attente / 1000}s...`);
      await patienter(attente);
    }

    const echecs = [];
    for (let i = 0; i < restantes.length; i += parallele) {
      const paquet = restantes.slice(i, i + parallele);
      await Promise.all(paquet.map(async (demande) => {
        try {
          resultats.set(demande.cle, await obtenirImage(demande.cle, demande.url));
        } catch (err) {
          echecs.push(demande);
          if (tentative === tentatives) {
            // Une image manquante n'est pas bloquante : la fiche existera sans
            // photo, et le systeme sait deja l'afficher (initiales, cadre vide).
            resultats.set(demande.cle, null);
            journal?.(`  photo indisponible (${demande.cle}) : ${err.message || 'echec reseau'}`);
          }
        }
      }));
      // Un souffle entre les paquets : c'est ce qui distingue un usage
      // raisonnable d'un service public d'une rafale qu'il finit par refuser.
      await patienter(120);
    }
    restantes = echecs;
  }

  return resultats;
}

/**
 * Liste complete des images du jeu de demonstration.
 *
 * Definie ici, et non dans le script de remplissage, parce que deux programmes
 * doivent s'accorder au fichier pres : celui qui constitue le lot versionne et
 * celui qui le consomme. Les cles ne dependent que d'un index, jamais d'un
 * identifiant de base : elles restent donc les memes d'une execution a l'autre.
 */
function demandesPhotosDemo() {
  const D = require('./donnees');
  const demandes = [];

  D.EMPLOYES.forEach((e, i) => demandes.push({
    cle: `portrait-${i}`, url: urlPortrait(e.sexe, e.portrait), usage: 'portrait',
  }));
  D.PRODUITS.forEach((p, i) => demandes.push({
    cle: `produit-${i}`, url: urlPhoto(`machibel-produit-${i}`, ...TAILLES.produit), usage: 'produit',
  }));
  D.EMPLOYES.forEach((e, i) => {
    D.DOCUMENTS_TYPES.forEach((t, r) => {
      for (let page = 0; page < t.pages; page += 1) {
        demandes.push({
          cle: `doc-${i}-${r}-${page}`,
          url: urlPhoto(`machibel-doc-${i}-${r}-${page}`, ...TAILLES.document),
          usage: 'document',
        });
      }
    });
  });

  return demandes;
}

module.exports = {
  obtenirImage, obtenirLot, urlPortrait, urlPhoto,
  depuisLot, demandesPhotosDemo, CACHE, LOT,
};
