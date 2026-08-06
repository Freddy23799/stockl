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

/**
 * Telecharge en parallele, mais par petits paquets : lancer quatre-vingts
 * requetes d'un coup fait tomber ces services publics en limitation de debit,
 * et on recupere alors des erreurs plutot que des images.
 */
async function obtenirLot(demandes, { parallele = 6, journal = null } = {}) {
  const resultats = new Map();
  for (let i = 0; i < demandes.length; i += parallele) {
    const paquet = demandes.slice(i, i + parallele);
    await Promise.all(paquet.map(async ({ cle, url }) => {
      try {
        resultats.set(cle, await obtenirImage(cle, url));
      } catch (err) {
        // Une image manquante n'est pas bloquante : la fiche existera sans
        // photo, et le systeme sait deja l'afficher (initiales, cadre vide).
        resultats.set(cle, null);
        journal?.(`  photo indisponible (${cle}) : ${err.message}`);
      }
    }));
  }
  return resultats;
}

module.exports = { obtenirImage, obtenirLot, urlPortrait, urlPhoto, CACHE };
