// -----------------------------------------------------------------------------
// Numerotation des factures de vente.
//
// Une facture porte un numero qui ne bouge plus jamais : reimprimee six mois
// plus tard, elle doit sortir exactement le meme. Le numero est donc attribue
// une seule fois, a l'enregistrement de la vente, dans SA transaction - et non
// calcule au moment d'imprimer.
//
// Format FA-AAAA-NNNNN, la serie repartant a 1 chaque annee civile, comme le
// veut l'usage comptable.
//
// Le compteur vit dans une table dediee et non dans un `max(numero) + 1`. Deux
// caisses qui encaissent a la meme seconde liraient le meme maximum et
// attribueraient deux fois le meme numero - ce qu'aucune comptabilite
// n'accepte. Ici, l'increment se fait en une seule instruction atomique, et
// l'index unique sur `ventes.numero_facture` reste le dernier rempart.
// -----------------------------------------------------------------------------

const PREFIXE = 'FA';
const LONGUEUR_SERIE = 5;

/**
 * Reserve le prochain numero de l'annee.
 * A appeler DANS la transaction de la vente : si la vente echoue, le numero
 * n'est pas consomme.
 *
 * @param {import('pg').PoolClient} client
 * @param {Date|string} [date] date de la vente, aujourd'hui par defaut
 */
async function reserverNumero(client, date) {
  const annee = new Date(date || Date.now()).getFullYear();

  // `ON CONFLICT DO UPDATE` plutot qu'un SELECT puis UPDATE : l'increment est
  // atomique, et la ligne de l'annee est creee au premier passage sans avoir a
  // la prevoir.
  const { rows } = await client.query(
    `INSERT INTO compteurs_facture (annee, dernier) VALUES ($1, 1)
     ON CONFLICT (annee) DO UPDATE SET dernier = compteurs_facture.dernier + 1
     RETURNING dernier`,
    [annee]
  );

  const serie = String(rows[0].dernier).padStart(LONGUEUR_SERIE, '0');
  return `${PREFIXE}-${annee}-${serie}`;
}

/** Vrai si la sous-option de facturation est active. */
async function facturationActive(client) {
  const { rows } = await client.query('SELECT module_factures FROM parametres WHERE id = 1');
  return Boolean(rows[0]?.module_factures);
}

module.exports = { reserverNumero, facturationActive, PREFIXE };
