const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

// -----------------------------------------------------------------------------
// Traitement d'image, execute dans un fil d'execution separe.
//
// Redimensionner une photo d'un million de pixels en JavaScript pur coute
// environ 600 ms : 200 ms de decodage, 400 ms d'encodage. Fait dans le fil
// principal, ce temps ne ralentit pas seulement l'envoi en cours - il fige le
// serveur entier. Un contrat de dix pages bloquait toute l'application pendant
// sept secondes, et c'est ce qui donnait l'impression que "tout est lent".
//
// Ici, le fil principal reste libre de repondre aux autres requetes pendant que
// le calcul tourne a cote.
// -----------------------------------------------------------------------------

const FORMATS_TRAITABLES = ['.png', '.jpg', '.jpeg'];

function decoder(donnees, extension) {
  if (extension === '.png') {
    const image = PNG.sync.read(donnees);
    return { largeur: image.width, hauteur: image.height, pixels: image.data };
  }
  const image = jpeg.decode(donnees, { useTArray: true, formatAsRGBA: true });
  return { largeur: image.width, hauteur: image.height, pixels: image.data };
}

// Reduction par moyenne de boite : un simple echantillonnage laisse des bords
// en escalier tres visibles sur un document scanne, ou le texte devient illisible.
function reduire({ largeur, hauteur, pixels }, largeurCible, hauteurCible) {
  const sortie = Buffer.alloc(largeurCible * hauteurCible * 4);
  const ratioX = largeur / largeurCible;
  const ratioY = hauteur / hauteurCible;

  for (let y = 0; y < hauteurCible; y += 1) {
    const yDebut = Math.floor(y * ratioY);
    const yFin = Math.max(yDebut + 1, Math.floor((y + 1) * ratioY));

    for (let x = 0; x < largeurCible; x += 1) {
      const xDebut = Math.floor(x * ratioX);
      const xFin = Math.max(xDebut + 1, Math.floor((x + 1) * ratioX));

      let sommeR = 0; let sommeV = 0; let sommeB = 0; let sommeA = 0;
      let poids = 0; let nombre = 0;

      for (let sy = yDebut; sy < yFin; sy += 1) {
        for (let sx = xDebut; sx < xFin; sx += 1) {
          const i = (sy * largeur + sx) * 4;
          const alpha = pixels[i + 3];
          sommeR += pixels[i] * alpha;
          sommeV += pixels[i + 1] * alpha;
          sommeB += pixels[i + 2] * alpha;
          sommeA += alpha;
          poids += alpha;
          nombre += 1;
        }
      }

      const j = (y * largeurCible + x) * 4;
      if (poids === 0) {
        sortie[j] = 0; sortie[j + 1] = 0; sortie[j + 2] = 0; sortie[j + 3] = 0;
      } else {
        sortie[j] = Math.round(sommeR / poids);
        sortie[j + 1] = Math.round(sommeV / poids);
        sortie[j + 2] = Math.round(sommeB / poids);
        sortie[j + 3] = Math.round(sommeA / nombre);
      }
    }
  }
  return sortie;
}

function aDeLaTransparence(pixels) {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true;
  }
  return false;
}

function encoder({ pixels, largeur, hauteur }, { transparent }) {
  if (transparent) {
    const png = new PNG({ width: largeur, height: hauteur });
    pixels.copy(png.data);
    // Niveau 6 plutot que 9 : mesure a l'appui, le gain de taille est inferieur
    // a 2 % pour un temps quasiment identique. Autant garder la marge.
    return { donnees: PNG.sync.write(png, { deflateLevel: 6 }), extension: '.png' };
  }
  return { donnees: jpeg.encode({ data: pixels, width: largeur, height: hauteur }, 82).data, extension: '.jpg' };
}

/**
 * Traite un fichier et le remplace sur place.
 * Retourne toujours un resultat, jamais une exception : un fichier illisible ne
 * doit pas faire perdre la piece versee au dossier.
 */
function traiter({ chemin, coteMax }) {
  const tailleOrigine = fs.statSync(chemin).size;
  const extension = path.extname(chemin).toLowerCase();
  const inchange = { tailleOrigine, tailleFinale: tailleOrigine, chemin, optimise: false };

  if (!FORMATS_TRAITABLES.includes(extension)) return inchange;

  try {
    const donnees = fs.readFileSync(chemin);
    const image = decoder(donnees, extension);
    const cote = Math.max(image.largeur, image.hauteur);
    const facteur = cote > coteMax ? coteMax / cote : 1;

    // Rien a redimensionner et fichier deja leger : le reencoder couterait
    // 600 ms pour quelques pourcents. On n'y touche pas.
    if (facteur === 1 && tailleOrigine <= 300 * 1024) return inchange;

    const largeurCible = Math.max(1, Math.round(image.largeur * facteur));
    const hauteurCible = Math.max(1, Math.round(image.hauteur * facteur));
    const pixels = facteur < 1
      ? reduire(image, largeurCible, hauteurCible)
      : Buffer.from(image.pixels);

    const transparent = aDeLaTransparence(pixels);
    const { donnees: sortie, extension: extensionFinale } = encoder(
      { pixels, largeur: largeurCible, hauteur: hauteurCible },
      { transparent }
    );

    if (sortie.length >= tailleOrigine) return inchange;

    let cheminFinal = chemin;
    if (extensionFinale !== extension) {
      cheminFinal = chemin.slice(0, -extension.length) + extensionFinale;
    }
    fs.writeFileSync(cheminFinal, sortie);
    if (cheminFinal !== chemin) {
      try { fs.unlinkSync(chemin); } catch { /* deja parti */ }
    }
    return { tailleOrigine, tailleFinale: sortie.length, chemin: cheminFinal, optimise: true };
  } catch {
    return inchange;
  }
}

parentPort.on('message', ({ id, tache }) => {
  parentPort.postMessage({ id, resultat: traiter(tache) });
});
