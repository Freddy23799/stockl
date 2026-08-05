const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const config = require('../config');

const TAILLE_MAX = 5 * 1024 * 1024;
const FORMATS_IMAGE = ['.jpg', '.jpeg', '.png', '.webp'];
const FORMATS_LOGO = [...FORMATS_IMAGE, '.svg'];

class FormatFichierError extends Error {
  constructor(formats) {
    super(`Format non accepte. Formats autorises : ${formats.join(', ')}`);
    this.name = 'FormatFichierError';
  }
}

// Chaque envoi est ecrit sous un nom TEMPORAIRE, puis renomme seulement une fois
// recu en entier (voir finaliserFichier).
//
// Sans cela, multer ouvre directement le fichier de destination final, y ecrit,
// puis supprime ce qu'il a ecrit quand la taille limite est depassee : l'ancien
// fichier - le logo en place, la photo du produit - est detruit par un envoi qui
// echoue, et la base continue de pointer vers un chemin devenu vide.
function stockageTemporaire(sousDossier) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dossier = path.join(config.uploadsDir, sousDossier);
      // Le dossier peut manquer au premier demarrage sur un disque neuf.
      fs.mkdir(dossier, { recursive: true }, (err) => cb(err, dossier));
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `.tmp-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  });
}

function filtreFormats(formats) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!formats.includes(ext)) return cb(new FormatFichierError(formats));
    return cb(null, true);
  };
}

const uploadProduitPhoto = multer({
  storage: stockageTemporaire('produits'),
  limits: { fileSize: TAILLE_MAX },
  fileFilter: filtreFormats(FORMATS_IMAGE),
});

const uploadLogo = multer({
  storage: stockageTemporaire('logo'),
  limits: { fileSize: TAILLE_MAX },
  fileFilter: filtreFormats(FORMATS_LOGO),
});

/**
 * Renomme le fichier temporaire en son nom definitif, une fois l'envoi complet
 * et valide. Retourne le chemin relatif a stocker en base.
 *
 * `nomSansExtension` est fourni par l'appelant (id du produit, "logo-machibel").
 * L'extension d'origine est conservee.
 */
function finaliserFichier(fichier, sousDossier, nomSansExtension) {
  const ext = path.extname(fichier.filename).toLowerCase();
  const nomFinal = `${nomSansExtension}${ext}`;
  const dossier = path.join(config.uploadsDir, sousDossier);
  fs.renameSync(fichier.path, path.join(dossier, nomFinal));
  return `uploads/${sousDossier}/${nomFinal}`;
}

/**
 * Supprime les versions du meme fichier portant une AUTRE extension.
 * Passer d'un PNG a un SVG laisserait sinon l'ancien fichier orphelin sur le
 * disque indefiniment.
 */
function nettoyerAnciennesVersions(sousDossier, nomSansExtension, cheminConserve) {
  const dossier = path.join(config.uploadsDir, sousDossier);
  const aConserver = path.basename(cheminConserve);
  let entrees = [];
  try {
    entrees = fs.readdirSync(dossier);
  } catch {
    return;
  }
  for (const nom of entrees) {
    if (nom === aConserver) continue;
    if (path.parse(nom).name !== nomSansExtension) continue;
    try {
      fs.unlinkSync(path.join(dossier, nom));
    } catch {
      // Un fichier deja absent ou verrouille ne doit pas faire echouer l'envoi.
    }
  }
}

/**
 * Traduit les erreurs d'envoi en reponses lisibles. Sans ce middleware, un
 * fichier trop lourd remonte en 500 "Erreur serveur", ce qui n'aide personne.
 * A monter juste apres les routes qui acceptent un fichier.
 */
// eslint-disable-next-line no-unused-vars
function gererErreursUpload(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: `Fichier trop lourd : ${Math.round(TAILLE_MAX / 1024 / 1024)} Mo maximum.`,
        code: 'FICHIER_TROP_LOURD',
      });
    }
    return res.status(400).json({ message: `Envoi refuse : ${err.message}`, code: err.code });
  }
  if (err instanceof FormatFichierError) {
    return res.status(400).json({ message: err.message, code: 'FORMAT_NON_ACCEPTE' });
  }
  return next(err);
}

module.exports = {
  uploadProduitPhoto,
  uploadLogo,
  finaliserFichier,
  nettoyerAnciennesVersions,
  gererErreursUpload,
  TAILLE_MAX,
};
