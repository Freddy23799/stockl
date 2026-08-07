// Classement des produits par rayon.
//
// La migration 016 a ajoute `produits.categorie_id`, mais les references deja
// saisies sont arrivees sans rayon. Le filtre par rayon de la caisse et les
// statistiques par rayon n'affichent donc rien tant que personne n'a repris le
// catalogue produit par produit - ce que personne ne fait.
//
// Le classement se deduit du NOM. C'est la seule information disponible, et
// elle est suffisante : un article s'appelle rarement autrement que par ce
// qu'il est. Une reference dont le nom ne dit rien reste sans rayon plutot que
// d'atterrir dans un fourre-tout, parce qu'un rayon faux coute plus cher a
// l'exploitant qu'un rayon vide.

const RAYONS = [
  { nom: 'Parfums', description: 'Eaux de parfum, eaux de toilette, musc et huiles parfumees' },
  { nom: 'Soins du corps', description: 'Laits, cremes, beurres, huiles et gommages pour le corps' },
  { nom: 'Soins du visage', description: 'Serums, masques, nettoyants et soins du teint' },
  { nom: 'Cheveux', description: 'Shampooings, soins capillaires et huiles pour cheveux' },
  { nom: 'Hygiene et bain', description: 'Savons, gels douche, deodorants et rasage' },
  { nom: 'Maquillage', description: 'Teint, levres et ongles' },
  { nom: 'Maison et ambiance', description: 'Encens, bougies, diffuseurs et parfums d\'interieur' },
  { nom: 'Coffrets et cadeaux', description: 'Coffrets, ecrins et emballages cadeaux' },
  { nom: 'Accessoires', description: 'Flacons, brosses, peignes et petit materiel' },
];

// Ordre significatif : la premiere regle qui reconnait le nom l'emporte.
//
// Les regles les plus specifiques passent d'abord, parce que les noms se
// chevauchent. "Bougie parfumee Oud" contient "parfum" sans etre un parfum ;
// "Brume cheveux parfumee" est un soin capillaire ; "Savon noir gommant" est un
// produit d'hygiene et non un gommage de soin. Deplacer une ligne de ce tableau
// change donc silencieusement le classement : ne le reordonner qu'en verifiant
// le catalogue entier.
const REGLES = [
  { motif: /coffret|ecrin|sachet cadeau|pochette cadeau/, rayon: 'Coffrets et cadeaux' },
  { motif: /flacon|vaporisateur|roll-?on|brosse|peigne|bonnet/, rayon: 'Accessoires' },
  { motif: /ambiance|diffuseur|bougie|encens|bakhour|huile essentielle|brume d'oreiller/, rayon: 'Maison et ambiance' },
  { motif: /shampooing|capillaire|cheveux|ricin|demelan/, rayon: 'Cheveux' },
  { motif: /vernis|levres mat|rouge a levres|poudre compacte|fond de teint|mascara|crayon/, rayon: 'Maquillage' },
  { motif: /visage|serum|micellaire|demaquill|tonique|anti-?taches|eclaircissante|depigmentante/, rayon: 'Soins du visage' },
  { motif: /deodorant|gel douche|savon|talc|rasage|alun/, rayon: 'Hygiene et bain' },
  { motif: /corporel|creme|beurre|karite|argan|coco|monoi|gommage|baume|lait |aloe|mains/, rayon: 'Soins du corps' },
  { motif: /parfum|toilette|musc|cologne|extrait|echantillon/, rayon: 'Parfums' },
];

// Les noms saisis a la main portent des accents, ceux du catalogue de
// demonstration n'en portent pas. Comparer sans accent evite d'ecrire chaque
// regle en double.
function normaliser(nom) {
  return String(nom || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function rayonDe(nom) {
  const propre = normaliser(nom);
  const regle = REGLES.find((r) => r.motif.test(propre));
  return regle ? regle.rayon : null;
}

async function executer(client, logger) {
  const { rows: aClasser } = await client.query(
    'SELECT id, nom FROM produits WHERE categorie_id IS NULL'
  );

  // Base encore vide : l'amorcage de demonstration tourne apres l'ouverture du
  // port et n'a pas encore insere le catalogue. On ne s'inscrit pas, le
  // demarrage suivant reprendra le travail.
  if (aClasser.length === 0) {
    const { rows } = await client.query('SELECT count(*)::int AS total FROM produits');
    if (rows[0].total === 0) return null;
  }

  // Les rayons sont crees meme si aucun produit ne s'y range : la liste
  // deroulante du formulaire doit etre utilisable des le premier produit saisi.
  const identifiants = new Map();
  for (const rayon of RAYONS) {
    // DO NOTHING sans cible : l'unicite est portee par un index d'expression,
    // que `ON CONFLICT (colonne)` ne sait pas designer. Le RETURNING vide
    // signale alors que le rayon existait deja.
    const { rows } = await client.query(
      `INSERT INTO categories (nom, description) VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [rayon.nom, rayon.description]
    );
    if (rows[0]) {
      identifiants.set(rayon.nom, rows[0].id);
      continue;
    }
    const { rows: existant } = await client.query(
      'SELECT id FROM categories WHERE lower(trim(nom)) = lower(trim($1))',
      [rayon.nom]
    );
    identifiants.set(rayon.nom, existant[0].id);
  }

  const parRayon = {};
  let classes = 0;

  for (const produit of aClasser) {
    const rayon = rayonDe(produit.nom);
    if (!rayon) continue;
    // La condition sur categorie_id est redondante avec le SELECT, mais elle
    // garantit qu'on n'ecrase jamais un classement pose entre-temps a la main.
    const { rowCount } = await client.query(
      'UPDATE produits SET categorie_id = $1 WHERE id = $2 AND categorie_id IS NULL',
      [identifiants.get(rayon), produit.id]
    );
    if (rowCount) {
      classes += 1;
      parRayon[rayon] = (parRayon[rayon] || 0) + 1;
    }
  }

  const sansRayon = aClasser.length - classes;
  if (sansRayon > 0) {
    logger.log(`  ${sansRayon} produit(s) laisse(s) sans rayon : nom non reconnu`);
  }

  return { rayons: RAYONS.length, produits_classes: classes, sans_rayon: sansRayon, detail: parRayon };
}

module.exports = {
  nom: '001-rayons-produits',
  description: 'Cree les rayons et classe les produits existants d\'apres leur nom',
  executer,
  // Exportes pour les tests et pour le classement des produits amorces.
  rayonDe,
  RAYONS,
};
