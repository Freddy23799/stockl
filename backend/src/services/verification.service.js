const crypto = require('crypto');
const QRCode = require('qrcode');
const { jwtSecret } = require('../config');

// -----------------------------------------------------------------------------
// Authentification des documents produits par le systeme.
//
// Un badge et un recu de paie sont des pieces qu'on presente : ils doivent
// pouvoir etre verifies. Un QR qui contiendrait seulement "matricule 42XKM" ne
// prouverait rien du tout - n'importe qui peut imprimer ce texte.
//
// Le code porte donc une SIGNATURE : une empreinte HMAC de son contenu, calculee
// avec le secret du serveur. Elle ne peut pas etre fabriquee sans ce secret, et
// le serveur la recalcule pour repondre "authentique" ou "faux". Le secret ne
// quitte jamais le serveur : le QR ne contient que le resultat.
// -----------------------------------------------------------------------------

const PREFIXE = 'MACHIBEL';

// Version du format : un jour ou la structure changera, les anciens codes
// devront rester verifiables. Sans ce numero, ils deviendraient tous invalides.
const VERSION = '1';

const TYPES = { BADGE: 'BADGE', RECU: 'RECU' };

// 16 caracteres hexadecimaux, soit 64 bits. Falsifier une signature demanderait
// des milliards d'essais, alors qu'un QR plus long devient illisible une fois
// imprime dans un carre de deux centimetres.
const LONGUEUR_SIGNATURE = 16;

function signer(charge) {
  return crypto
    .createHmac('sha256', jwtSecret)
    .update(charge)
    .digest('hex')
    .slice(0, LONGUEUR_SIGNATURE)
    .toUpperCase();
}

/**
 * Compose le contenu d'un QR verifiable.
 * Forme : MACHIBEL:1:TYPE:IDENTIFIANT:SIGNATURE
 */
function composerJeton(type, identifiant) {
  const charge = `${PREFIXE}:${VERSION}:${type}:${identifiant}`;
  return `${charge}:${signer(charge)}`;
}

/**
 * Verifie un jeton scanne.
 * @returns {{ valide: boolean, type?: string, identifiant?: string, raison?: string }}
 */
function verifierJeton(jeton) {
  if (typeof jeton !== 'string' || !jeton.trim()) {
    return { valide: false, raison: 'Code vide' };
  }

  const parties = jeton.trim().split(':');
  if (parties.length !== 5) {
    return { valide: false, raison: "Ce code n'a pas ete produit par MACHIBEL" };
  }

  const [prefixe, version, type, identifiant, signature] = parties;
  if (prefixe !== PREFIXE) {
    return { valide: false, raison: "Ce code n'a pas ete produit par MACHIBEL" };
  }
  if (version !== VERSION) {
    return { valide: false, raison: `Format de code inconnu (version ${version})` };
  }
  if (!Object.values(TYPES).includes(type)) {
    return { valide: false, raison: `Type de document inconnu (${type})` };
  }

  const attendue = signer(`${prefixe}:${version}:${type}:${identifiant}`);

  // Comparaison a temps constant : une comparaison ordinaire s'arrete au premier
  // caractere different, ce qui laisse deviner la signature octet par octet en
  // mesurant le temps de reponse.
  const a = Buffer.from(signature.toUpperCase());
  const b = Buffer.from(attendue);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valide: false, raison: 'Signature invalide : ce document est un faux ou a ete altere' };
  }

  return { valide: true, type, identifiant };
}

/**
 * Produit le QR en PNG, pret a etre embarque dans un PDF.
 *
 * Correction d'erreur au niveau M (environ 15 % de redondance) : un badge se
 * raye et se salit, un recu se plie. Le niveau H serait plus robuste mais
 * densifie le motif au point de le rendre illisible une fois imprime petit.
 */
async function qrEnPng(contenu, { taille = 320, marge = 1 } = {}) {
  return QRCode.toBuffer(contenu, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: marge,
    width: taille,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}

const jetonBadge = (matricule) => composerJeton(TYPES.BADGE, matricule);
const jetonRecu = (numeroRecu) => composerJeton(TYPES.RECU, numeroRecu);

module.exports = { composerJeton, verifierJeton, qrEnPng, jetonBadge, jetonRecu, TYPES };
