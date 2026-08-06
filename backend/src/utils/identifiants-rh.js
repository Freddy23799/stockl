const crypto = require('crypto');

// -----------------------------------------------------------------------------
// Identifiants lisibles a voix haute.
//
// Un matricule se dicte au telephone, se recopie sur un registre papier, se lit
// sur un badge use. L'alphabet exclut donc les glyphes qui se confondent : le
// zero et le O, le un et le I, le S et le 5. Une erreur de lecture sur un
// numero de recu, c'est un paiement introuvable.
// -----------------------------------------------------------------------------

// Lettres sans I ni O.
const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
// Chiffres sans 0 ni 1.
const CHIFFRES = '23456789';
// Alphabet mixte des references et numeros de recu.
const ALPHABET_REFERENCE = CHIFFRES + LETTRES;

// `randomInt` du module crypto est uniforme, contrairement a `Math.random() * n`
// arrondi, qui privilegie legerement les premieres valeurs. Sans importance
// pour un tirage isole, mais ces identifiants doivent rester impossibles a
// deviner : un numero de recu previsible permettrait de fabriquer un faux.
function tirer(alphabet, longueur) {
  let sortie = '';
  for (let i = 0; i < longueur; i += 1) {
    sortie += alphabet[crypto.randomInt(alphabet.length)];
  }
  return sortie;
}

/** Matricule employe : deux chiffres puis trois lettres majuscules (ex. 42XKM). */
function genererMatricule() {
  return tirer(CHIFFRES, 2) + tirer(LETTRES, 3);
}

/** Reference de cycle de paie ou numero de recu : huit caracteres. */
function genererReference() {
  return tirer(ALPHABET_REFERENCE, 8);
}

/**
 * Tire un identifiant absent de la table visee.
 *
 * La collision est improbable (17 576 matricules possibles pour 100 employes,
 * plus de 10^12 references) mais pas impossible, et une contrainte d'unicite
 * qui saute renverrait une erreur illisible a l'utilisateur. On retente donc,
 * dans la transaction en cours pour que la verification et l'insertion voient
 * le meme etat.
 */
async function genererUnique(client, { table, colonne, fabrique, essais = 12 }) {
  for (let i = 0; i < essais; i += 1) {
    const valeur = fabrique();
    const { rows } = await client.query(
      `SELECT 1 FROM ${table} WHERE ${colonne} = $1 LIMIT 1`,
      [valeur]
    );
    if (rows.length === 0) return valeur;
  }
  throw new Error(
    `Impossible de generer un ${colonne} unique pour ${table} apres ${essais} essais.`
  );
}

const genererMatriculeUnique = (client) =>
  genererUnique(client, { table: 'employes', colonne: 'matricule', fabrique: genererMatricule });

const genererReferenceCycleUnique = (client) =>
  genererUnique(client, { table: 'paie_cycles', colonne: 'reference', fabrique: genererReference });

const genererNumeroRecuUnique = (client) =>
  genererUnique(client, { table: 'paie_versements', colonne: 'numero_recu', fabrique: genererReference });

module.exports = {
  genererMatricule,
  genererReference,
  genererMatriculeUnique,
  genererReferenceCycleUnique,
  genererNumeroRecuUnique,
};
