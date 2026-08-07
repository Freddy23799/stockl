// Marques du catalogue de demonstration.
//
// Le rayon se lit dans le nom du produit ; la marque, non. "Eau de parfum Oud
// Royal" ne dit pas qui la fabrique, et aucune regle ne peut l'inventer sans
// risquer de coller un fabricant faux sur la marchandise d'un vrai commerce.
//
// Ce traitement ne s'applique donc QUE si la base porte le jeu de
// demonstration - c'est-a-dire un catalogue que nous avons ecrit nous-memes.
// Sur la base d'un client, il ne fait rien et ne s'inscrit jamais : il sera
// reexamine a chaque demarrage, au cas ou la demonstration serait posee plus
// tard, pour le cout d'un SELECT.
//
// Sans lui, les marques existent dans le formulaire mais aucun produit n'en
// porte : le filtre par marque et les statistiques par marque restent vides, et
// la fonctionnalite parait cassee alors qu'elle attend seulement des donnees.

const AMORCAGE_DEMO = 'demonstration-2024-2026';

const MARQUES = [
  { nom: 'Dubai Fragrance', description: 'Parfums orientaux : oud, ambre, bois et musc' },
  { nom: 'Essences Orientales', description: 'Parfums floraux et gourmands' },
  { nom: 'Al Nour', description: 'Eaux de toilette fraiches et lignes homme' },
  { nom: 'Karite Bio', description: 'Beurres et huiles vegetales brutes' },
  { nom: 'Beaute Afrique', description: 'Soins du visage et du corps' },
  { nom: 'Golfe Beaute', description: 'Hygiene quotidienne et rasage' },
  { nom: 'Afro Care', description: 'Soins et accessoires cheveux' },
  { nom: 'Belle Couleur', description: 'Maquillage teint, levres et ongles' },
  { nom: 'Maison Machibel', description: 'Ambiance, coffrets et contenants' },
];

// Meme principe que pour les rayons : premiere regle qui reconnait le nom.
// L'ordre separe d'abord ce qui n'est pas un parfum, puis repartit les parfums
// par famille olfactive - ce qui donne trois marques dans un meme rayon, la
// situation que la fonctionnalite doit savoir montrer.
const REGLES = [
  { motif: /coffret|sachet cadeau|flacon|roll-?on|vaporisateur/, marque: 'Maison Machibel' },
  { motif: /brosse|peigne|bonnet/, marque: 'Afro Care' },
  { motif: /encens|bakhour|bougie|diffuseur|ambiance|huile essentielle|oreiller/, marque: 'Maison Machibel' },
  { motif: /shampooing|capillaire|ricin|cheveux/, marque: 'Afro Care' },
  { motif: /vernis|rouge a levres|poudre compacte/, marque: 'Belle Couleur' },
  { motif: /visage|serum|micellaire|demaquill|tonique|anti-?taches|eclaircissante|depigmentante/, marque: 'Beaute Afrique' },
  { motif: /deodorant|gel douche|savon|talc|rasage|alun/, marque: 'Golfe Beaute' },
  { motif: /karite|coco|argan|monoi|beurre/, marque: 'Karite Bio' },
  { motif: /corporel|creme|gommage|baume|lait |aloe|mains/, marque: 'Beaute Afrique' },
  { motif: /oud|ambre|bois|musc|musk|cuir|santal|malaki|taifi/, marque: 'Dubai Fragrance' },
  { motif: /rose|fleur|jasmin|vanille|mangue|oranger|peche|imperiale/, marque: 'Essences Orientales' },
  { motif: /parfum|toilette|echantillon|homme|sport|brise|agrume|enfant|douceur/, marque: 'Al Nour' },
];

function normaliser(nom) {
  return String(nom || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function marqueDe(nom) {
  const propre = normaliser(nom);
  const regle = REGLES.find((r) => r.motif.test(propre));
  return regle ? regle.marque : null;
}

async function executer(client, logger) {
  const { rows: amorcage } = await client.query(
    "SELECT etat FROM amorcages WHERE nom = $1 AND etat = 'applique'",
    [AMORCAGE_DEMO]
  );
  if (amorcage.length === 0) return null;

  const { rows: aMarquer } = await client.query(
    'SELECT id, nom FROM produits WHERE marque_id IS NULL'
  );
  if (aMarquer.length === 0) return null;

  const identifiants = new Map();
  for (const marque of MARQUES) {
    const { rows } = await client.query(
      `INSERT INTO marques (nom, description) VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [marque.nom, marque.description]
    );
    if (rows[0]) {
      identifiants.set(marque.nom, rows[0].id);
      continue;
    }
    const { rows: existant } = await client.query(
      'SELECT id FROM marques WHERE lower(trim(nom)) = lower(trim($1))',
      [marque.nom]
    );
    identifiants.set(marque.nom, existant[0].id);
  }

  const parMarque = {};
  let marques = 0;

  for (const produit of aMarquer) {
    const marque = marqueDe(produit.nom);
    if (!marque) continue;
    const { rowCount } = await client.query(
      'UPDATE produits SET marque_id = $1 WHERE id = $2 AND marque_id IS NULL',
      [identifiants.get(marque), produit.id]
    );
    if (rowCount) {
      marques += 1;
      parMarque[marque] = (parMarque[marque] || 0) + 1;
    }
  }

  const sansMarque = aMarquer.length - marques;
  if (sansMarque > 0) {
    logger.log(`  ${sansMarque} produit(s) laisse(s) sans marque : nom non reconnu`);
  }

  return { marques: MARQUES.length, produits_marques: marques, sans_marque: sansMarque, detail: parMarque };
}

module.exports = {
  nom: '002-marques-demonstration',
  description: 'Cree les marques du catalogue de demonstration et les attribue',
  executer,
  marqueDe,
  MARQUES,
};
