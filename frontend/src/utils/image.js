// -----------------------------------------------------------------------------
// Reduction des images AVANT l'envoi.
//
// Une photo prise au telephone fait couramment 3 Mo pour 12 millions de pixels.
// La reduire sur le serveur coute environ quatre secondes, dont plus de trois
// pour le seul decodage JPEG en JavaScript pur - et il faut d'abord avoir
// transfere les 3 Mo, ce qui sur une connexion mobile est le plus long.
//
// Le navigateur, lui, decode et redimensionne avec l'acceleration materielle en
// une centaine de millisecondes. Reduire ici, c'est donc a la fois un envoi
// quinze fois plus leger et un serveur qui n'a presque plus rien a faire.
//
// La reduction cote serveur est conservee comme filet : elle rattrape ce qui
// arrive par un autre chemin, et un navigateur trop ancien pour cette fonction
// enverra simplement le fichier tel quel.
// -----------------------------------------------------------------------------

// Une page A4 numerisee a 1600 pixels de haut donne environ 135 points par
// pouce : le texte y reste parfaitement lisible a l'ecran comme a la
// reimpression. Au dela, on transporte des details que personne ne regardera.
const COTE_MAX_DOCUMENT = 1600;
const COTE_MAX_PHOTO = 800;

// En dessous, l'image est deja legere : la retraiter ne gagnerait rien et lui
// ferait perdre en nettete pour rien.
const SEUIL_OCTETS = 180 * 1024;

const QUALITE = 0.82;

function estImage(fichier) {
  return /^image\/(jpeg|png|webp)$/i.test(fichier.type);
}

function chargerImage(fichier) {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resoudre(image) }
    // L'URL doit etre liberee dans les deux cas : la laisser en place retient le
    // fichier en memoire pour toute la duree de la page.
    image.onerror = () => { URL.revokeObjectURL(url); rejeter(new Error('Image illisible')) }
    image.src = url
  })
}

/**
 * Reduit une image si elle en a besoin.
 * Retourne toujours un File exploitable : en cas d'echec, l'original.
 *
 * @param {File} fichier
 * @param {number} coteMax  plus grand cote conserve
 */
export async function reduireImage(fichier, coteMax = COTE_MAX_DOCUMENT) {
  if (!estImage(fichier)) return fichier

  try {
    const image = await chargerImage(fichier)
    const cote = Math.max(image.naturalWidth, image.naturalHeight)

    // Rien a redimensionner et fichier deja leger : on n'y touche pas.
    if (cote <= coteMax && fichier.size <= SEUIL_OCTETS) return fichier

    const facteur = cote > coteMax ? coteMax / cote : 1
    const largeur = Math.max(1, Math.round(image.naturalWidth * facteur))
    const hauteur = Math.max(1, Math.round(image.naturalHeight * facteur))

    const canvas = document.createElement('canvas')
    canvas.width = largeur
    canvas.height = hauteur
    const contexte = canvas.getContext('2d')
    // Sans lissage de qualite, une reduction par quatre laisse un texte
    // numerise crenele et difficile a relire.
    contexte.imageSmoothingEnabled = true
    contexte.imageSmoothingQuality = 'high'

    // Un PNG transparent aplati sur du noir devient illisible : on pose un fond
    // blanc, qui est de toute facon celui d'une page numerisee.
    contexte.fillStyle = '#ffffff'
    contexte.fillRect(0, 0, largeur, hauteur)
    contexte.drawImage(image, 0, 0, largeur, hauteur)

    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITE))
    if (!blob) return fichier

    // Un fichier deja bien compresse peut ressortir plus lourd : dans ce cas on
    // garde l'original, la reduction n'a pas lieu d'etre.
    if (blob.size >= fichier.size) return fichier

    const nom = fichier.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nom, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    // Format exotique, canvas indisponible, image corrompue : l'envoi doit
    // aboutir quand meme, le serveur reduira ce qu'il peut.
    return fichier
  }
}

/** Reduit une liste de fichiers, en laissant passer ce qui n'est pas une image. */
export async function reduireImages(fichiers, coteMax = COTE_MAX_DOCUMENT) {
  return Promise.all([...fichiers].map((f) => reduireImage(f, coteMax)))
}

export { COTE_MAX_DOCUMENT, COTE_MAX_PHOTO }
