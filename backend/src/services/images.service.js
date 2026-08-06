const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

/**
 * Reduction et mise en cache des images servies par l'application.
 *
 * Le probleme est le meme partout : les images arrivent a leur taille d'origine
 * alors qu'elles sont affichees minuscules.
 *
 *  - le logo livre par defaut fait 1024 x 1024 pour 1,4 Mo, et il est imprime
 *    dans un carre de 52 points, soit moins de deux centimetres. Embarque tel
 *    quel, il representait 98 % du poids d'un rapport : un document d'une page
 *    passait de 35 ko a 1,95 Mo ;
 *  - une photo prise au telephone pese plusieurs mega-octets et s'affiche dans
 *    une vignette de 40 pixels dans la liste des produits. Une liste de
 *    cinquante references demanderait des dizaines de mega-octets.
 *
 * Sur une connexion mobile, c'est la difference entre une page instantanee et
 * une minute d'attente.
 *
 * Le redimensionnement est fait en JavaScript pur (pngjs, jpeg-js) plutot
 * qu'avec une bibliotheque native : le service tourne sur un hebergement sans
 * outil systeme d'imagerie, et une dependance native compilee serait une source
 * d'echec de deploiement pour un gain sans rapport avec l'enjeu.
 */

// Tailles nommees plutot qu'une largeur libre dans l'URL : un parametre ouvert
// laisserait n'importe qui demander mille variantes et remplir le disque.
const TAILLES = {
  // Vignette de liste et de panier.
  vignette: 96,
  // Fiche produit, apercu avant envoi.
  moyen: 480,
  // Logo imprime : 52 points a 300 points par pouce donnent 217 pixels.
  impression: 256,
};

// En dessous, l'image est deja assez legere : la retraiter ne gagnerait rien et
// ferait perdre en nettete.
const SEUIL_OCTETS = 120 * 1024;

const FORMATS_TRAITABLES = ['.png', '.jpg', '.jpeg'];

// Le cache vit hors de `uploads/`, et pour deux raisons.
//
// D'abord parce que `express.static` refuse de servir tout chemin dont un
// segment commence par un point : un cache nomme `.cache-images` place sous
// `uploads/` renvoyait "Not Found" alors que le fichier existait, et l'original
// de 1,4 Mo repartait a chaque fois sans que rien ne le signale.
//
// Ensuite parce qu'un cache n'a rien a faire dans un dossier expose sur le web :
// place ici, il n'est atteignable par aucune URL.
//
// Le dossier temporaire du systeme convient : toujours accessible en ecriture,
// y compris quand le repertoire de l'application ne l'est pas, et vide par le
// systeme. Le contenu est reconstruit a la demande, sa perte est sans
// consequence.
const DOSSIER_CACHE = path.join(os.tmpdir(), 'machibel-images');

/* --- Decodage ------------------------------------------------------------- */

function decoder(chemin, extension) {
  const donnees = fs.readFileSync(chemin);
  if (extension === '.png') {
    const image = PNG.sync.read(donnees);
    return { largeur: image.width, hauteur: image.height, pixels: image.data };
  }
  // jpeg-js renvoie du RGBA quand on le lui demande explicitement, ce qui
  // uniformise le traitement avec le PNG.
  const image = jpeg.decode(donnees, { useTArray: true, formatAsRGBA: true });
  return { largeur: image.width, hauteur: image.height, pixels: image.data };
}

/* --- Reduction ------------------------------------------------------------ */

/**
 * Reduction par moyenne de boite.
 *
 * Un simple echantillonnage du plus proche voisin produit des bords en escalier
 * tres visibles sur un logo, qui est justement fait d'aplats et de traits nets.
 * Moyenner tous les pixels source qui tombent dans un pixel de destination
 * coute quelques millisecondes et donne un rendu propre.
 *
 * La moyenne des couleurs est ponderee par l'alpha : sans cela, les pixels
 * transparents (souvent noirs dans le tampon) tirent les bords vers le sombre
 * et dessinent un lisere disgracieux autour du logo.
 */
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
        // Zone entierement transparente : la couleur n'a pas de sens, on garde
        // du transparent pur.
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

/* --- Encodage ------------------------------------------------------------- */

// Une photo est reencodee en JPEG : sur un cliche, le PNG sans perte pese cinq
// a dix fois plus lourd pour un resultat visuellement identique. Un logo garde
// le PNG, seul format des deux a conserver la transparence.
function encoder({ pixels, largeur, hauteur }, { transparent }) {
  if (transparent) {
    const png = new PNG({ width: largeur, height: hauteur });
    pixels.copy(png.data);
    return { donnees: PNG.sync.write(png, { deflateLevel: 9 }), extension: '.png' };
  }
  const resultat = jpeg.encode({ data: pixels, width: largeur, height: hauteur }, 82);
  return { donnees: resultat.data, extension: '.jpg' };
}

// Une image sans pixel reellement translucide n'a pas besoin du PNG. On le
// verifie plutot que de le supposer : beaucoup de PNG portent un canal alpha
// entierement opaque.
function aDeLaTransparence(pixels) {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true;
  }
  return false;
}

/* --- Cache ---------------------------------------------------------------- */

// La cle depend du chemin, de la taille du fichier et de sa date de
// modification : une nouvelle image televersee produit une cle differente, donc
// une regeneration, sans qu'on ait a invalider quoi que ce soit a la main.
function cleCache(chemin, stats, coteMax) {
  return crypto.createHash('sha1')
    .update(`${chemin}|${stats.size}|${stats.mtimeMs}|${coteMax}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Produit une version reduite de l'image et renvoie son chemin absolu.
 * Retombe toujours sur le fichier d'origine plutot que d'echouer : une image un
 * peu lourde vaut mieux qu'une page cassee ou un rapport qui ne se genere pas.
 *
 * @param {string} chemin  chemin absolu du fichier source
 * @param {number} coteMax plus grand cote de l'image produite, en pixels
 * @param {object} [options]
 * @param {boolean} [options.forcer] traite meme les fichiers sous le seuil
 * @returns {string} chemin absolu a servir
 */
function versionReduite(chemin, coteMax, { forcer = false } = {}) {
  try {
    const extension = path.extname(chemin).toLowerCase();
    if (!FORMATS_TRAITABLES.includes(extension)) return chemin;

    const stats = fs.statSync(chemin);
    if (!forcer && stats.size <= SEUIL_OCTETS) return chemin;

    const cle = cleCache(chemin, stats, coteMax);
    // L'extension de sortie n'est connue qu'apres decodage : on teste les deux
    // formes possibles avant de refaire le travail.
    for (const suffixe of ['.png', '.jpg']) {
      const candidat = path.join(DOSSIER_CACHE, `img-${cle}${suffixe}`);
      if (fs.existsSync(candidat)) return candidat;
    }

    const source = decoder(chemin, extension);
    if (!source.largeur || !source.hauteur) return chemin;

    const facteur = Math.min(1, coteMax / Math.max(source.largeur, source.hauteur));
    const largeur = Math.max(1, Math.round(source.largeur * facteur));
    const hauteur = Math.max(1, Math.round(source.hauteur * facteur));

    // Deja assez petite en pixels malgre un fichier lourd (image peu
    // compressee) : le seul reencodage suffit a la degonfler.
    const pixels = facteur < 1
      ? reduire(source, largeur, hauteur)
      : Buffer.from(source.pixels);

    const transparent = aDeLaTransparence(pixels);
    const { donnees, extension: extensionSortie } = encoder(
      { pixels, largeur, hauteur },
      { transparent }
    );

    // Le reencodage peut grossir une image deja bien compressee : dans ce cas
    // on garde l'original, il n'y a rien a gagner.
    if (donnees.length >= stats.size && facteur === 1) return chemin;

    const destination = path.join(DOSSIER_CACHE, `img-${cle}${extensionSortie}`);
    fs.mkdirSync(DOSSIER_CACHE, { recursive: true });
    // Ecriture atomique : deux requetes simultanees produisent le meme fichier,
    // et un lecteur ne doit jamais tomber sur une image a moitie ecrite.
    const temporaire = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporaire, donnees);
    fs.renameSync(temporaire, destination);

    return destination;
  } catch {
    // Format exotique, fichier corrompu, disque plein : l'original reste
    // parfaitement utilisable.
    return chemin;
  }
}

/** Logo pret a etre embarque dans un PDF. */
function preparerLogo(chemin) {
  return versionReduite(chemin, TAILLES.impression);
}

/* --- Optimisation a l'envoi ----------------------------------------------- */

// Cote le plus long conserve pour une piece versee au dossier d'un employe.
// Une page A4 numerisee a 1600 pixels de haut donne environ 135 points par
// pouce : un texte imprime y reste parfaitement lisible a l'ecran comme a la
// reimpression, pour une fraction du poids d'origine. Au dela, on stocke des
// details que personne ne regardera jamais.
const COTE_MAX_DOCUMENT = 1600;

// Une photo d'identite ne sert qu'au badge et a la fiche : 800 pixels suffisent
// tres largement, le badge l'imprime dans 25 millimetres.
const COTE_MAX_PHOTO = 800;

/**
 * Reduit un fichier deja televerse, sur place.
 *
 * Applique aux pieces des dossiers employes et aux photos. Le fichier d'origine
 * est remplace : conserver les deux ferait doubler l'occupation disque pour un
 * original que personne ne consultera.
 *
 * Ce qui n'est pas une image traitable est laisse intact. Un PDF ne peut pas
 * etre recompresse de facon sure sans outil natif, et le degrader au hasard sur
 * un contrat signe serait bien pire que de le stocker tel quel.
 *
 * @returns {{ tailleOrigine: number, tailleFinale: number, chemin: string, optimise: boolean }}
 */
function optimiserFichierTelverse(cheminAbsolu, { coteMax = COTE_MAX_DOCUMENT } = {}) {
  const tailleOrigine = fs.statSync(cheminAbsolu).size;
  const extension = path.extname(cheminAbsolu).toLowerCase();

  const resultatInchange = {
    tailleOrigine, tailleFinale: tailleOrigine, chemin: cheminAbsolu, optimise: false,
  };

  if (!FORMATS_TRAITABLES.includes(extension)) return resultatInchange;

  try {
    const image = decoder(cheminAbsolu, extension);
    const cote = Math.max(image.largeur, image.hauteur);
    const facteur = cote > coteMax ? coteMax / cote : 1;

    const largeurCible = Math.max(1, Math.round(image.largeur * facteur));
    const hauteurCible = Math.max(1, Math.round(image.hauteur * facteur));

    const pixels = facteur < 1
      ? reduire(image, largeurCible, hauteurCible)
      : Buffer.from(image.pixels);

    const transparent = aDeLaTransparence(pixels);
    const { donnees, extension: extensionFinale } = encoder(
      { pixels, largeur: largeurCible, hauteur: hauteurCible },
      { transparent }
    );

    // Un fichier deja bien compresse peut ressortir plus lourd apres
    // reencodage : dans ce cas on garde l'original, l'optimisation n'a pas lieu
    // d'etre.
    if (donnees.length >= tailleOrigine) return resultatInchange;

    // Le format peut changer (un PNG photographique devient un JPEG) : le nom
    // suit, sinon un fichier .png contiendrait du JPEG et aucun lecteur ne
    // saurait l'ouvrir.
    let cheminFinal = cheminAbsolu;
    if (extensionFinale !== extension) {
      cheminFinal = cheminAbsolu.slice(0, -extension.length) + extensionFinale;
    }

    fs.writeFileSync(cheminFinal, donnees);
    if (cheminFinal !== cheminAbsolu) {
      try { fs.unlinkSync(cheminAbsolu); } catch { /* deja parti */ }
    }

    return { tailleOrigine, tailleFinale: donnees.length, chemin: cheminFinal, optimise: true };
  } catch {
    // Image corrompue ou format exotique portant une extension connue :
    // l'echec de l'optimisation ne doit jamais faire perdre le fichier.
    return resultatInchange;
  }
}

module.exports = {
  versionReduite,
  preparerLogo,
  optimiserFichierTelverse,
  TAILLES,
  SEUIL_OCTETS,
  FORMATS_TRAITABLES,
  COTE_MAX_DOCUMENT,
  COTE_MAX_PHOTO,
};
