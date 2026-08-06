// -----------------------------------------------------------------------------
// Donnees de reference du jeu de demonstration.
//
// L'objectif n'est pas d'avoir "beaucoup de lignes" mais une histoire qui se
// tient sur deux ans et demi : des gens arrivent, sont augmentes, changent de
// poste, partent ; des produits se vendent bien, d'autres dorment ; du stock se
// casse ; des salaires se paient parfois en deux fois.
//
// Tout est fixe, jamais aleatoire au niveau des identites : rejouer le
// remplissage doit redonner exactement les memes personnes, sinon on ne peut
// plus comparer deux executions ni retrouver un cas qu'on avait repere.
// -----------------------------------------------------------------------------

const DEBUT = '2024-01-02';

const ETABLISSEMENT = {
  etablissement_nom: 'PARFUMERIE MACHIBEL',
  etablissement_slogan: "L'elegance au quotidien",
  etablissement_activite: 'Vente de parfums, cosmetiques et produits de soin',
  etablissement_adresse: 'Avenue Kennedy, immeuble Sofia, 2e etage',
  etablissement_quartier: 'Bastos',
  etablissement_ville: 'Yaounde',
  etablissement_pays: 'Cameroun',
  etablissement_boite_postale: '12457',
  etablissement_telephone: '+237 6 99 00 11 22',
  etablissement_telephone_2: '+237 2 22 33 44 55',
  etablissement_email: 'contact@machibel.cm',
  etablissement_site_web: 'stock.schoolshub.org',
  etablissement_registre_commerce: 'RC/YAO/2023/B/1847',
  etablissement_identifiant_fiscal: 'M082300194726P',
  etablissement_capital: '5 000 000 FCFA',
  etablissement_mention_pied: 'Document interne - diffusion restreinte',
  devise: 'FCFA',
};

const FONCTIONS = [
  { nom: 'Gerante', description: "Direction du point de vente et supervision de l'equipe" },
  { nom: 'Vendeuse', description: 'Conseil client, tenue de la caisse et mise en rayon' },
  { nom: 'Vendeur', description: 'Conseil client et tenue de la caisse' },
  { nom: 'Caissiere', description: 'Encaissement et arrete de caisse' },
  { nom: 'Magasinier', description: 'Reception des marchandises, rangement et inventaires' },
  { nom: 'Agent d\'entretien', description: 'Proprete du magasin et des reserves' },
  { nom: 'Livreur', description: 'Livraisons a domicile et courses' },
  { nom: 'Comptable', description: 'Suivi des ecritures, rapprochements et declarations' },
  { nom: 'Vigile', description: 'Securite du magasin et controle des acces' },
];

/**
 * Employes.
 *
 * `carriere` decrit les periodes SUCCESSIVES apres l'embauche : chaque entree
 * ouvre une nouvelle periode et ferme la precedente. `depart` bloque la fiche a
 * la date donnee, avec son motif.
 */
const EMPLOYES = [
  {
    prenom: 'Aminata', nom: 'Bello', sexe: 'F', portrait: 26,
    fonction: 'Gerante', salaire: 250000, embauche: '2024-01-02',
    telephone: '+237 6 99 12 34 56', ville: 'Yaounde', quartier: 'Bastos',
    cni: '110234567', contrat: 'CDI', naissance: '1988-04-17',
    urgence: ['Moussa Bello', '+237 6 77 11 22 33', 'Epoux'],
    carriere: [
      { date: '2025-01-01', salaire: 275000, motif: 'Revalorisation annuelle' },
      { date: '2026-01-01', salaire: 300000, motif: 'Revalorisation annuelle' },
    ],
  },
  {
    prenom: 'Fatou', nom: 'Sow', sexe: 'F', portrait: 44,
    fonction: 'Vendeuse', salaire: 110000, embauche: '2024-01-02',
    telephone: '+237 6 55 21 09 87', ville: 'Yaounde', quartier: 'Mvog-Mbi',
    cni: '110987123', contrat: 'CDI', naissance: '1995-09-03',
    urgence: ['Awa Sow', '+237 6 90 44 55 66', 'Soeur'],
    vendeuse: true,
    carriere: [
      { date: '2024-09-01', salaire: 125000, motif: 'Fin de periode d\'essai concluante' },
      { date: '2025-07-01', salaire: 145000, fonction: 'Caissiere', motif: 'Promotion' },
      { date: '2026-03-01', salaire: 160000, motif: 'Revalorisation' },
    ],
  },
  {
    prenom: 'Jean', nom: 'Ndongo', sexe: 'M', portrait: 31,
    fonction: 'Magasinier', salaire: 95000, embauche: '2024-01-15',
    telephone: '+237 6 78 45 12 30', ville: 'Yaounde', quartier: 'Nkoldongo',
    cni: '111223344', contrat: 'CDI', naissance: '1991-12-11',
    urgence: ['Marie Ndongo', '+237 6 99 88 77 66', 'Mere'],
    carriere: [
      { date: '2025-02-01', salaire: 108000, motif: 'Revalorisation' },
      { date: '2026-02-01', salaire: 120000, motif: 'Anciennete' },
    ],
  },
  {
    prenom: 'Marie', nom: 'Atangana', sexe: 'F', portrait: 9,
    fonction: 'Vendeuse', salaire: 105000, embauche: '2024-02-01',
    telephone: '+237 6 91 33 22 11', ville: 'Yaounde', quartier: 'Essos',
    cni: '112334455', contrat: 'CDI', naissance: '1997-06-28',
    urgence: ['Paul Atangana', '+237 6 70 12 13 14', 'Pere'],
    vendeuse: true,
    carriere: [
      { date: '2024-10-01', salaire: 118000, motif: 'Fin de periode d\'essai' },
      { date: '2025-10-01', salaire: 132000, motif: 'Revalorisation annuelle' },
    ],
  },
  {
    prenom: 'Paul', nom: 'Mbarga', sexe: 'M', portrait: 52,
    fonction: 'Livreur', salaire: 85000, embauche: '2024-02-12',
    telephone: '+237 6 82 77 66 55', ville: 'Yaounde', quartier: 'Mokolo',
    cni: '113445566', contrat: 'CDI', naissance: '1993-03-22',
    urgence: ['Sylvie Mbarga', '+237 6 55 99 88 77', 'Epouse'],
    carriere: [
      { date: '2025-04-01', salaire: 95000, motif: 'Revalorisation' },
    ],
  },
  {
    prenom: 'Solange', nom: 'Nkomo', sexe: 'F', portrait: 63,
    fonction: 'Vendeuse', salaire: 100000, embauche: '2024-03-04',
    telephone: '+237 6 94 10 20 30', ville: 'Yaounde', quartier: 'Emana',
    cni: '114556677', contrat: 'CDD', naissance: '1999-11-05',
    urgence: ['Georges Nkomo', '+237 6 77 45 45 45', 'Frere'],
    vendeuse: true,
    // Un depart en cours de route : le systeme doit continuer d'afficher ses
    // ventes passees tout en la retirant des cycles de paie et des badges.
    depart: { date: '2025-06-30', motif: 'Fin de contrat a duree determinee, non renouvele' },
  },
  {
    prenom: 'Ibrahim', nom: 'Traore', sexe: 'M', portrait: 18,
    fonction: 'Vigile', salaire: 78000, embauche: '2024-03-18',
    telephone: '+237 6 66 32 14 78', ville: 'Yaounde', quartier: 'Etoudi',
    cni: '115667788', contrat: 'CDI', naissance: '1990-07-14',
    urgence: ['Aissatou Traore', '+237 6 88 21 32 43', 'Epouse'],
    carriere: [
      { date: '2025-05-01', salaire: 88000, motif: 'Revalorisation' },
      { date: '2026-05-01', salaire: 96000, motif: 'Anciennete' },
    ],
  },
  {
    prenom: 'Chantal', nom: 'Eyenga', sexe: 'F', portrait: 71,
    fonction: 'Comptable', salaire: 180000, embauche: '2024-04-02',
    telephone: '+237 6 79 55 44 33', ville: 'Yaounde', quartier: 'Bastos',
    cni: '116778899', contrat: 'CDI', naissance: '1986-01-30',
    urgence: ['Rene Eyenga', '+237 6 91 91 91 91', 'Epoux'],
    carriere: [
      { date: '2025-04-01', salaire: 200000, motif: 'Revalorisation annuelle' },
      { date: '2026-04-01', salaire: 215000, motif: 'Revalorisation annuelle' },
    ],
  },
  {
    prenom: 'Cedric', nom: 'Fotso', sexe: 'M', portrait: 40,
    fonction: 'Vendeur', salaire: 100000, embauche: '2024-06-03',
    telephone: '+237 6 71 88 99 00', ville: 'Yaounde', quartier: 'Melen',
    cni: '117889900', contrat: 'CDI', naissance: '1996-08-09',
    urgence: ['Bernadette Fotso', '+237 6 60 60 60 60', 'Mere'],
    vendeuse: true,
    carriere: [
      { date: '2025-06-01', salaire: 115000, motif: 'Revalorisation' },
      { date: '2026-06-01', salaire: 128000, motif: 'Revalorisation' },
    ],
  },
  {
    prenom: 'Rachelle', nom: 'Ngo Bell', sexe: 'F', portrait: 85,
    fonction: 'Vendeuse', salaire: 102000, embauche: '2024-09-16',
    telephone: '+237 6 93 47 58 69', ville: 'Yaounde', quartier: 'Ngousso',
    cni: '118990011', contrat: 'CDI', naissance: '1998-02-19',
    urgence: ['Josephine Ngo Bell', '+237 6 74 74 74 74', 'Mere'],
    vendeuse: true,
    carriere: [
      { date: '2025-09-01', salaire: 116000, motif: 'Revalorisation annuelle' },
    ],
  },
  {
    prenom: 'Emmanuel', nom: 'Kamga', sexe: 'M', portrait: 5,
    fonction: 'Magasinier', salaire: 92000, embauche: '2025-01-06',
    telephone: '+237 6 58 63 74 85', ville: 'Yaounde', quartier: 'Biyem-Assi',
    cni: '119001122', contrat: 'Essai', naissance: '1994-10-27',
    urgence: ['Clarisse Kamga', '+237 6 82 82 82 82', 'Soeur'],
    carriere: [
      { date: '2025-07-01', salaire: 104000, fonction: 'Magasinier', motif: 'Fin de periode d\'essai' },
    ],
    // Blocage disciplinaire : la fiche reste, l'acces est coupe partout.
    depart: { date: '2026-02-28', motif: 'Suspension disciplinaire - ecarts de caisse repetes non justifies' },
  },
  {
    prenom: 'Nadege', nom: 'Owona', sexe: 'F', portrait: 33,
    fonction: 'Vendeuse', salaire: 108000, embauche: '2025-03-03',
    telephone: '+237 6 95 74 85 96', ville: 'Yaounde', quartier: 'Odza',
    cni: '120112233', contrat: 'CDI', naissance: '2000-05-12',
    urgence: ['Alain Owona', '+237 6 63 63 63 63', 'Pere'],
    vendeuse: true,
    carriere: [
      { date: '2026-03-01', salaire: 122000, motif: 'Revalorisation annuelle' },
    ],
  },
  {
    prenom: 'Serge', nom: 'Biya', sexe: 'M', portrait: 67,
    fonction: 'Livreur', salaire: 88000, embauche: '2025-05-05',
    telephone: '+237 6 68 85 96 07', ville: 'Yaounde', quartier: 'Nsimeyong',
    cni: '121223344', contrat: 'CDD', naissance: '1992-09-08',
    urgence: ['Estelle Biya', '+237 6 51 51 51 51', 'Epouse'],
  },
  {
    prenom: 'Brigitte', nom: 'Manga', sexe: 'F', portrait: 55,
    fonction: 'Agent d\'entretien', salaire: 72000, embauche: '2025-08-04',
    telephone: '+237 6 97 96 07 18', ville: 'Yaounde', quartier: 'Mendong',
    cni: '122334455', contrat: 'CDI', naissance: '1989-12-01',
    urgence: ['Thomas Manga', '+237 6 49 49 49 49', 'Epoux'],
    carriere: [
      { date: '2026-08-01', salaire: 80000, motif: 'Revalorisation annuelle' },
    ],
  },
  {
    prenom: 'Yvette', nom: 'Tchoumi', sexe: 'F', portrait: 79,
    fonction: 'Vendeuse', salaire: 115000, embauche: '2026-01-05',
    telephone: '+237 6 92 07 18 29', ville: 'Yaounde', quartier: 'Nkolbisson',
    cni: '123445566', contrat: 'Essai', naissance: '2001-03-16',
    urgence: ['Pauline Tchoumi', '+237 6 38 38 38 38', 'Mere'],
    vendeuse: true,
  },
  {
    prenom: 'Armand', nom: 'Essomba', sexe: 'M', portrait: 22,
    fonction: 'Vendeur', salaire: 112000, embauche: '2026-04-06',
    telephone: '+237 6 64 18 29 30', ville: 'Yaounde', quartier: 'Ekounou',
    cni: '124556677', contrat: 'Essai', naissance: '1997-11-23',
    urgence: ['Diane Essomba', '+237 6 27 27 27 27', 'Soeur'],
    vendeuse: true,
  },
];

const FOURNISSEURS = [
  { nom: 'Parfums Import Douala', contact: '+237 6 99 45 12 78 - importdla@mail.cm' },
  { nom: 'Cosmetiques du Golfe', contact: '+237 2 33 42 15 60 - contact@cosmetigolfe.cm' },
  { nom: 'Al Nour Distribution', contact: '+237 6 77 82 34 51 - alnour.dist@mail.com' },
  { nom: 'Beaute Afrique SARL', contact: '+237 6 55 12 89 04 - commercial@beauteafrique.cm' },
  { nom: 'Essences Orientales', contact: '+237 6 91 60 73 28 - essences.or@mail.cm' },
  { nom: 'Grossiste Mokolo Beaute', contact: '+237 6 70 33 44 55' },
  { nom: 'Dubai Fragrance House', contact: '+971 4 555 0198 - export@dubaifragrance.ae', arrivee: '2024-07-15' },
  { nom: 'Karite Bio Burkina', contact: '+226 70 55 12 33 - ventes@karitebio.bf', arrivee: '2024-11-04' },
  {
    nom: 'Cosmetiques Express Bafoussam', contact: '+237 6 96 74 12 08',
    arrivee: '2025-02-10',
    // Un fournisseur avec qui on cesse de travailler : ses entrees passees
    // restent au journal, mais il n'est plus proposable a la reception.
    fin: { date: '2026-01-20', motif: 'Retards de livraison repetes' },
  },
  {
    nom: 'Import Beaute Nigeria', contact: '+234 803 445 2210',
    arrivee: '2025-06-02',
    fin: { date: '2026-05-15', motif: 'Cessation d\'activite du fournisseur' },
  },
];

/**
 * Catalogue.
 *
 * `rotation` dit a quelle frequence relative le produit se vend : c'est ce qui
 * cree des best-sellers et des articles qui dorment, au lieu d'une distribution
 * uniforme qui ne ressemble a aucun commerce reel.
 */
const PRODUITS = [
  { nom: 'Eau de parfum Nuit d\'Ambre 100 mL', prix: 45000, achat: 26000, rotation: 9, seuil: 6 },
  { nom: 'Eau de parfum Rose Imperiale 100 mL', prix: 52000, achat: 30000, rotation: 8, seuil: 6 },
  { nom: 'Eau de parfum Oud Royal 100 mL', prix: 78000, achat: 47000, rotation: 5, seuil: 4 },
  { nom: 'Eau de parfum Fleur de Mangue 90 mL', prix: 38000, achat: 21000, rotation: 7, seuil: 6 },
  { nom: 'Eau de parfum Bois de Santal 100 mL', prix: 61000, achat: 36000, rotation: 4, seuil: 4 },
  { nom: 'Eau de toilette Brise Marine 100 mL', prix: 28000, achat: 15000, rotation: 10, seuil: 8 },
  { nom: 'Eau de toilette Agrumes Vifs 100 mL', prix: 24000, achat: 13000, rotation: 9, seuil: 8 },
  { nom: 'Eau de toilette Vanille Douce 75 mL', prix: 22000, achat: 12000, rotation: 8, seuil: 8 },
  { nom: 'Eau de toilette Jasmin Blanc 75 mL', prix: 26000, achat: 14500, rotation: 7, seuil: 6 },
  { nom: 'Musc blanc concentre 12 mL', prix: 9000, achat: 4200, rotation: 12, seuil: 15 },
  { nom: 'Musc noir concentre 12 mL', prix: 9500, achat: 4400, rotation: 10, seuil: 15 },
  { nom: 'Huile parfumee Oud 10 mL', prix: 14000, achat: 7000, rotation: 8, seuil: 12 },
  { nom: 'Huile parfumee Rose 10 mL', prix: 12500, achat: 6200, rotation: 7, seuil: 12 },
  { nom: 'Encens Bakhour traditionnel 50 g', prix: 7500, achat: 3400, rotation: 9, seuil: 20 },
  { nom: 'Deodorant spray Fraicheur 150 mL', prix: 4500, achat: 2100, rotation: 14, seuil: 25 },
  { nom: 'Deodorant bille Peau Sensible 50 mL', prix: 3800, achat: 1750, rotation: 12, seuil: 25 },
  { nom: 'Lait corporel Karite 400 mL', prix: 8500, achat: 4300, rotation: 11, seuil: 15 },
  { nom: 'Lait corporel Coco 400 mL', prix: 8000, achat: 4000, rotation: 10, seuil: 15 },
  { nom: 'Creme eclaircissante Nuit 250 mL', prix: 15000, achat: 8200, rotation: 9, seuil: 10 },
  { nom: 'Creme hydratante Aloe 200 mL', prix: 11000, achat: 5800, rotation: 8, seuil: 12 },
  { nom: 'Gel douche Fleur de Coton 500 mL', prix: 5500, achat: 2600, rotation: 12, seuil: 20 },
  { nom: 'Gel douche Menthe Fraiche 500 mL', prix: 5500, achat: 2600, rotation: 10, seuil: 20 },
  { nom: 'Savon noir gommant 300 g', prix: 4200, achat: 1900, rotation: 11, seuil: 20 },
  { nom: 'Beurre de karite pur 250 g', prix: 6500, achat: 3100, rotation: 10, seuil: 18 },
  { nom: 'Huile d\'argan pure 100 mL', prix: 13500, achat: 7200, rotation: 6, seuil: 10 },
  { nom: 'Serum visage Vitamine C 30 mL', prix: 18000, achat: 10500, rotation: 5, seuil: 8 },
  { nom: 'Masque visage Argile 150 mL', prix: 9500, achat: 4800, rotation: 6, seuil: 10 },
  { nom: 'Coffret decouverte 3 miniatures', prix: 35000, achat: 20000, rotation: 4, seuil: 5 },
  { nom: 'Coffret cadeau Prestige', prix: 85000, achat: 52000, rotation: 2, seuil: 3 },
  { nom: 'Brume corporelle Peche 200 mL', prix: 7000, achat: 3300, rotation: 9, seuil: 15 },
  { nom: 'Brume corporelle Monoi 200 mL', prix: 7200, achat: 3400, rotation: 8, seuil: 15 },
  { nom: 'Vernis a ongles longue tenue', prix: 3500, achat: 1400, rotation: 10, seuil: 30 },
  { nom: 'Rouge a levres mat', prix: 6800, achat: 3000, rotation: 9, seuil: 20 },
  { nom: 'Poudre compacte teint unifie', prix: 9800, achat: 4900, rotation: 7, seuil: 15 },
  { nom: 'Parfum d\'ambiance Vanille 200 mL', prix: 11500, achat: 5900, rotation: 5, seuil: 10 },
  { nom: 'Eau de parfum Cuir Ambre 100 mL', prix: 68000, achat: 41000, rotation: 4, seuil: 4, arrivee: '2024-05-06' },
  { nom: 'Eau de parfum Fleur d\'Oranger 90 mL', prix: 42000, achat: 24000, rotation: 6, seuil: 6, arrivee: '2024-05-06' },
  { nom: 'Eau de toilette Homme Sport 100 mL', prix: 27000, achat: 14500, rotation: 9, seuil: 8, arrivee: '2024-06-10' },
  { nom: 'Eau de toilette Homme Intense 100 mL', prix: 31000, achat: 17000, rotation: 7, seuil: 6, arrivee: '2024-06-10' },
  { nom: 'Apres-rasage Fraicheur 100 mL', prix: 8500, achat: 4100, rotation: 8, seuil: 12, arrivee: '2024-06-10' },
  { nom: 'Huile de coco vierge 250 mL', prix: 7500, achat: 3600, rotation: 9, seuil: 15, arrivee: '2024-09-02' },
  { nom: 'Huile de ricin noire 100 mL', prix: 6800, achat: 3200, rotation: 8, seuil: 15, arrivee: '2024-09-02' },
  { nom: 'Shampooing cheveux crepus 400 mL', prix: 9200, achat: 4600, rotation: 10, seuil: 15, arrivee: '2024-11-12' },
  { nom: 'Apres-shampooing nourrissant 400 mL', prix: 9800, achat: 4900, rotation: 8, seuil: 12, arrivee: '2024-11-12' },
  { nom: 'Masque capillaire karite 300 mL', prix: 11500, achat: 5700, rotation: 6, seuil: 10, arrivee: '2024-11-12' },
  { nom: 'Gommage corporel sucre 250 mL', prix: 8800, achat: 4200, rotation: 7, seuil: 12, arrivee: '2025-01-13' },
  { nom: 'Creme mains reparatrice 75 mL', prix: 4200, achat: 1900, rotation: 11, seuil: 20, arrivee: '2025-01-13' },
  { nom: 'Baume levres karite', prix: 2500, achat: 1000, rotation: 13, seuil: 30, arrivee: '2025-01-13' },
  { nom: 'Eau micellaire demaquillante 400 mL', prix: 7800, achat: 3800, rotation: 9, seuil: 15, arrivee: '2025-04-07' },
  { nom: 'Lingettes demaquillantes x25', prix: 3200, achat: 1400, rotation: 10, seuil: 25, arrivee: '2025-04-07' },
  { nom: 'Coffret homme Elegance', prix: 62000, achat: 37000, rotation: 3, seuil: 3, arrivee: '2025-09-01' },
  { nom: 'Diffuseur de parfum a batonnets', prix: 16500, achat: 8300, rotation: 4, seuil: 8, arrivee: '2025-09-01' },
  { nom: 'Bougie parfumee Oud 180 g', prix: 13000, achat: 6400, rotation: 5, seuil: 10, arrivee: '2025-09-01' },
  { nom: 'Eau de parfum Vanille Noire 100 mL', prix: 55000, achat: 32000, rotation: 6, seuil: 5, arrivee: '2026-02-02' },
  { nom: 'Brume cheveux parfumee 150 mL', prix: 8900, achat: 4300, rotation: 7, seuil: 12, arrivee: '2026-02-02' },

  // A partir d'ici, les conditionnements sortent du carton de douze : des lots
  // de six pour les articles fragiles, de vingt-quatre ou quarante-huit pour les
  // petits formats, et surtout des references vendues au VOLUME ou au POIDS.
  // Sans elles, le facteur de conversion valait douze partout et la conversion
  // achat/vente n'etait jamais reellement mise a l'epreuve.
  { nom: 'Parfum en vrac Oud Malaki (au mL)', prix: 950, achat: 420, rotation: 11, seuil: 400,
    unite: 'mL', uniteAchat: 'bidon 1 L', facteur: 1000, arrivee: '2024-04-08' },
  { nom: 'Parfum en vrac Musk Tahara (au mL)', prix: 780, achat: 340, rotation: 10, seuil: 400,
    unite: 'mL', uniteAchat: 'bidon 1 L', facteur: 1000, arrivee: '2024-04-08' },
  { nom: 'Parfum en vrac Ambre Blanc (au mL)', prix: 1100, achat: 500, rotation: 8, seuil: 300,
    unite: 'mL', uniteAchat: 'bidon 500 mL', facteur: 500, arrivee: '2024-07-22' },
  { nom: 'Encens Oud brut (au gramme)', prix: 320, achat: 145, rotation: 12, seuil: 500,
    unite: 'g', uniteAchat: 'sachet 1 kg', facteur: 1000, arrivee: '2024-04-08' },
  { nom: 'Encens Bakhour Al Haramain (au gramme)', prix: 280, achat: 120, rotation: 10, seuil: 500,
    unite: 'g', uniteAchat: 'sachet 1 kg', facteur: 1000, arrivee: '2024-10-14' },
  { nom: 'Beurre de karite brut (au gramme)', prix: 45, achat: 18, rotation: 13, seuil: 2000,
    unite: 'g', uniteAchat: 'seau 5 kg', facteur: 5000, arrivee: '2024-11-04' },
  { nom: 'Huile de coco en vrac (au mL)', prix: 38, achat: 15, rotation: 11, seuil: 1500,
    unite: 'mL', uniteAchat: 'bidon 5 L', facteur: 5000, arrivee: '2025-03-10' },

  { nom: 'Coffret Prestige Or 3 pieces', prix: 145000, achat: 92000, rotation: 1, seuil: 2,
    uniteAchat: 'carton de 6', facteur: 6, arrivee: '2024-11-18' },
  { nom: 'Eau de parfum Rose Taifi 50 mL', prix: 92000, achat: 58000, rotation: 2, seuil: 3,
    uniteAchat: 'carton de 6', facteur: 6, arrivee: '2024-11-18' },
  { nom: 'Flacon vaporisateur verre 50 mL', prix: 3500, achat: 1200, rotation: 12, seuil: 40,
    uniteAchat: 'carton de 48', facteur: 48, arrivee: '2024-05-20' },
  { nom: 'Flacon roll-on 10 mL', prix: 1800, achat: 550, rotation: 14, seuil: 60,
    uniteAchat: 'carton de 48', facteur: 48, arrivee: '2024-05-20' },
  { nom: 'Sachet cadeau organza', prix: 900, achat: 260, rotation: 13, seuil: 80,
    uniteAchat: 'lot de 100', facteur: 100, arrivee: '2024-05-20' },
  { nom: 'Echantillon parfum 2 mL', prix: 1500, achat: 480, rotation: 15, seuil: 100,
    uniteAchat: 'carton de 48', facteur: 48, arrivee: '2024-08-05' },

  { nom: 'Eau de parfum Ambre Nuit 100 mL', prix: 74000, achat: 44000, rotation: 4, seuil: 4,
    uniteAchat: 'carton de 6', facteur: 6, arrivee: '2025-02-17' },
  { nom: 'Eau de parfum Fleur de Coton 90 mL', prix: 48000, achat: 27500, rotation: 6, seuil: 6, arrivee: '2025-02-17' },
  { nom: 'Eau de toilette Enfant Douceur 75 mL', prix: 19000, achat: 9500, rotation: 8, seuil: 10,
    uniteAchat: 'carton de 24', facteur: 24, arrivee: '2025-05-12' },
  { nom: 'Talc parfume bebe 200 g', prix: 4800, achat: 2000, rotation: 10, seuil: 24,
    uniteAchat: 'carton de 24', facteur: 24, arrivee: '2025-05-12' },
  { nom: 'Savon de Marseille parfume 200 g', prix: 3200, achat: 1250, rotation: 12, seuil: 36,
    uniteAchat: 'carton de 36', facteur: 36, arrivee: '2025-05-12' },
  { nom: 'Deodorant pierre d\'alun 100 g', prix: 5600, achat: 2400, rotation: 7, seuil: 20,
    uniteAchat: 'carton de 24', facteur: 24, arrivee: '2025-07-07' },
  { nom: 'Creme depigmentante intense 300 mL', prix: 21000, achat: 12500, rotation: 8, seuil: 10, arrivee: '2025-07-07' },
  { nom: 'Serum anti-taches 30 mL', prix: 24000, achat: 14500, rotation: 5, seuil: 6,
    uniteAchat: 'carton de 6', facteur: 6, arrivee: '2025-07-07' },
  { nom: 'Gel nettoyant visage 200 mL', prix: 8900, achat: 4300, rotation: 9, seuil: 15, arrivee: '2025-10-06' },
  { nom: 'Tonique visage rose 200 mL', prix: 9500, achat: 4700, rotation: 6, seuil: 12, arrivee: '2025-10-06' },
  { nom: 'Huile essentielle lavande 15 mL', prix: 7800, achat: 3600, rotation: 6, seuil: 15,
    uniteAchat: 'carton de 24', facteur: 24, arrivee: '2025-10-06' },
  { nom: 'Huile essentielle eucalyptus 15 mL', prix: 7200, achat: 3300, rotation: 5, seuil: 15,
    uniteAchat: 'carton de 24', facteur: 24, arrivee: '2025-10-06' },
  { nom: 'Brosse a cheveux demelante', prix: 5400, achat: 2100, rotation: 8, seuil: 20,
    uniteAchat: 'carton de 24', facteur: 24, arrivee: '2026-01-12' },
  { nom: 'Peigne afro bois', prix: 2800, achat: 950, rotation: 9, seuil: 30,
    uniteAchat: 'lot de 50', facteur: 50, arrivee: '2026-01-12' },
  { nom: 'Bonnet satin protection cheveux', prix: 4500, achat: 1600, rotation: 10, seuil: 25,
    uniteAchat: 'carton de 24', facteur: 24, arrivee: '2026-01-12' },
  { nom: 'Eau de parfum Bois Precieux 100 mL', prix: 88000, achat: 54000, rotation: 3, seuil: 3,
    uniteAchat: 'carton de 6', facteur: 6, arrivee: '2026-03-16' },
  { nom: 'Coffret decouverte Femme 5 miniatures', prix: 42000, achat: 25000, rotation: 4, seuil: 4,
    uniteAchat: 'carton de 6', facteur: 6, arrivee: '2026-03-16' },
  { nom: 'Brume d\'oreiller relaxante 100 mL', prix: 9800, achat: 4600, rotation: 5, seuil: 12, arrivee: '2026-06-01' },
];

// References arretees en cours de route : rupture durable chez le fournisseur,
// gamme abandonnee. Le produit sort du catalogue mais son historique de ventes
// reste intact, et c'est exactement ce que le systeme doit savoir faire.
const PRODUITS_ARRETES = [
  { nom: 'Eau de toilette Vanille Douce 75 mL', date: '2025-08-12', motif: 'Gamme abandonnee par le fabricant' },
  { nom: 'Vernis a ongles longue tenue', date: '2025-11-03', motif: 'Rotation trop faible, place rendue au rayon soin' },
  { nom: 'Lingettes demaquillantes x25', date: '2026-04-21', motif: 'Rupture durable chez le fournisseur' },
];

const CATEGORIES_DEPENSE = [
  { nom: 'Loyer', montant: [180000, 180000], frequence: 'mensuel', jour: 5 },
  { nom: 'Electricite', montant: [28000, 62000], frequence: 'mensuel', jour: 12 },
  { nom: 'Eau', montant: [9000, 18000], frequence: 'mensuel', jour: 12 },
  { nom: 'Internet et telephone', montant: [35000, 35000], frequence: 'mensuel', jour: 8 },
  { nom: 'Transport', montant: [12000, 45000], frequence: 'frequent' },
  { nom: 'Fournitures de bureau', montant: [8000, 32000], frequence: 'occasionnel' },
  { nom: 'Entretien et reparations', montant: [15000, 90000], frequence: 'occasionnel' },
  { nom: 'Publicite', montant: [25000, 150000], frequence: 'occasionnel' },
  { nom: 'Frais bancaires', montant: [5000, 14000], frequence: 'mensuel', jour: 28 },
  { nom: 'Emballages et sachets', montant: [18000, 55000], frequence: 'occasionnel' },
];

// Pieces versees aux dossiers. Chaque document regroupe un ou plusieurs
// fichiers, comme un contrat numerise page par page.
const DOCUMENTS_TYPES = [
  { nom: 'Contrat de travail', categorie: 'contrat', pages: 3, pourTous: true },
  { nom: 'Carte nationale d\'identite', categorie: 'identite', pages: 2, pourTous: true },
  { nom: 'Diplomes et attestations', categorie: 'diplome', pages: 2, proportion: 0.6 },
  { nom: 'Certificat medical d\'aptitude', categorie: 'medical', pages: 1, proportion: 0.5 },
  { nom: 'Releve d\'identite bancaire', categorie: 'bancaire', pages: 1, proportion: 0.45 },
  { nom: 'Photo d\'identite', categorie: 'identite', pages: 1, proportion: 0.35 },
];

module.exports = {
  DEBUT, ETABLISSEMENT, FONCTIONS, EMPLOYES, FOURNISSEURS,
  PRODUITS, PRODUITS_ARRETES, CATEGORIES_DEPENSE, DOCUMENTS_TYPES,
};
