const crypto = require('crypto');

// Alphabet volontairement ampute des caracteres qu'on confond en lisant un mot
// de passe a voix haute ou sur un post-it : 0/O, 1/l/I, 5/S, 2/Z.
const LETTRES_MINUSCULES = 'abcdefghjkmnpqrstuvwxyz';
const LETTRES_MAJUSCULES = 'ABCDEFGHJKMNPQRSTUVWXY';
const CHIFFRES = '346789';
const ALPHABET = LETTRES_MINUSCULES + LETTRES_MAJUSCULES + CHIFFRES;

const TAILLE_BLOC = 4;
const NOMBRE_BLOCS = 3;

function tirer(alphabet) {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

/**
 * Mot de passe initial genere a la creation d'un compte : "k7Rm-9xPq-2Wtd".
 * Decoupe en blocs pour etre recopiable sans erreur par l'administrateur qui
 * le transmet a la personne concernee.
 *
 * Utilise crypto.randomInt (generateur cryptographique), jamais Math.random.
 */
function genererMotDePasse() {
  const blocs = [];
  for (let i = 0; i < NOMBRE_BLOCS; i += 1) {
    let bloc = '';
    for (let j = 0; j < TAILLE_BLOC; j += 1) bloc += tirer(ALPHABET);
    blocs.push(bloc);
  }

  const motDePasse = blocs.join('-');

  // Garantit au moins un chiffre et une majuscule, quelle que soit la chance du tirage.
  if (!/[0-9]/.test(motDePasse) || !/[A-Z]/.test(motDePasse)) {
    return genererMotDePasse();
  }
  return motDePasse;
}

module.exports = { genererMotDePasse };
