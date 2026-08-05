const fs = require('fs');
const path = require('path');
const config = require('../config');
const { versionReduite, TAILLES } = require('../services/images.service');

/**
 * Sert une version reduite d'une image televersee quand la requete le demande.
 *
 * Une photo prise au telephone pese plusieurs mega-octets ; dans la liste des
 * produits elle s'affiche dans une vignette de quelques dizaines de pixels.
 * Servir l'original a cet endroit fait telecharger cent fois ce qui est
 * necessaire, ce qui se paie cash sur une connexion mobile.
 *
 * S'intercale devant `express.static` : sans parametre `taille`, la requete
 * passe au suivant et l'original est servi comme avant. Le comportement
 * existant n'est donc pas modifie, seul un nouveau cas est ajoute.
 */

// Une semaine. Le nom du fichier change des qu'une photo est remplacee
// (`finaliserFichier` conserve le nom, mais la version reduite est indexee sur
// la date de modification), donc un cache long est sans danger cote serveur.
// Les navigateurs revalident de toute facon avec l'ETag.
const DUREE_CACHE_S = 7 * 24 * 3600;

function servirImageReduite(req, res, next) {
  const taille = req.query.taille;
  if (!taille) return next();

  const coteMax = TAILLES[taille];
  // Taille inconnue : on sert l'original plutot que de renvoyer une erreur.
  // Une image un peu lourde vaut mieux qu'une image manquante.
  if (!coteMax) return next();

  // `req.path` est deja decode et normalise par Express. On revalide malgre
  // tout que le chemin resolu reste sous le dossier des televersements : c'est
  // la seule barriere entre une URL et le disque du serveur.
  const demande = path.normalize(decodeURIComponent(req.path)).replace(/^(\.\.[/\\])+/, '');
  const original = path.resolve(config.uploadsDir, `.${path.sep}${demande}`);
  if (!original.startsWith(path.resolve(config.uploadsDir))) {
    return res.status(400).end();
  }
  if (!fs.existsSync(original) || !fs.statSync(original).isFile()) return next();

  const reduite = versionReduite(original, coteMax);

  res.setHeader('Cache-Control', `public, max-age=${DUREE_CACHE_S}, immutable`);
  // Signale aux caches intermediaires que la reponse depend du parametre : sans
  // cela, un proxy pourrait resservir la vignette a qui demande l'original.
  res.setHeader('Vary', 'Accept');
  return res.sendFile(reduite, (err) => {
    if (!err) return undefined;
    // Un echec ici est silencieux du point de vue de l'utilisateur : la chaine
    // statique prend le relais et sert l'original, donc la page reste correcte
    // mais lourde. C'est exactement le genre de regression qui passe inapercue,
    // d'ou cette trace.
    console.warn(`[images] version reduite non servie (${err.message}) : ${reduite}`);
    if (!res.headersSent) next();
    return undefined;
  });
}

module.exports = { servirImageReduite };
