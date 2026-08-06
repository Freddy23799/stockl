const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = require('../src/config/db');
const config = require('../src/config');
const { genererMatriculeUnique, genererReferenceCycleUnique, genererNumeroRecuUnique } = require('../src/utils/identifiants-rh');

const { obtenirLot, urlPortrait, urlPhoto } = require('./lib/photos');
const D = require('./lib/donnees');

// -----------------------------------------------------------------------------
// Remplissage du systeme avec deux ans et demi d'activite.
//
// Ce n'est pas un jeu d'essai jete en vrac : la simulation se deroule JOUR PAR
// JOUR, du 2 janvier 2024 a aujourd'hui. Chaque journee peut apporter des
// ventes, un reassort, une casse, une depense ; chaque fin de mois apporte un
// cycle de paie. L'ordre chronologique n'est pas un detail de presentation - il
// est la seule facon d'obtenir un stock qui ne devient jamais negatif, des
// couts FIFO justes, et une paie qui ne verse a personne un salaire qu'il ne
// touchait pas encore.
//
// Les invariants du systeme sont respectes exactement comme en production :
// les lots FIFO sont consommes au plus ancien, le stock et la somme des lots
// restent egaux, et chaque operation laisse sa trace au journal d'audit.
// -----------------------------------------------------------------------------

/* --- Hasard reproductible ------------------------------------------------- */

// Generateur a graine fixe : rejouer le remplissage doit redonner exactement le
// meme jeu de donnees. Sans cela, impossible de comparer deux executions ni de
// retrouver un cas qu'on avait repere la veille.
let graine = 20240102;
function alea() {
  graine = (graine * 1103515245 + 12345) & 0x7fffffff;
  return graine / 0x7fffffff;
}
const entre = (min, max) => min + Math.floor(alea() * (max - min + 1));
const parmi = (liste) => liste[Math.floor(alea() * liste.length)];
const chance = (p) => alea() < p;

/* --- Dates ---------------------------------------------------------------- */

const jour = (d) => d.toISOString().slice(0, 10);
const ajouterJours = (d, n) => new Date(d.getTime() + n * 86400000);

// Horodatage dans les heures d'ouverture : une vente enregistree a 3 h du matin
// se remarque tout de suite et decredibilise l'ensemble.
function heureOuvrable(date, base = 8, amplitude = 11) {
  const d = new Date(`${jour(date)}T00:00:00`);
  d.setHours(base + Math.floor(alea() * amplitude), entre(0, 59), entre(0, 59));
  return d.toISOString();
}

/* --- Journal -------------------------------------------------------------- */

const debut = Date.now();
function log(message) {
  const secondes = ((Date.now() - debut) / 1000).toFixed(1).padStart(6);
  console.log(`[${secondes}s] ${message}`);
}

/* --- Audit ---------------------------------------------------------------- */

// Ecriture directe : le module d'audit horodate a `now()`, or tout ici est
// retroactif. Meme forme versionnee que celle produite par l'application.
async function audit(client, { type, entiteId, utilisateurId, date, details, avant, apres }) {
  await client.query(
    `INSERT INTO historique_audit (type_operation, entite_id, utilisateur_id, details, date)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      type, entiteId ?? null, utilisateurId ?? null,
      JSON.stringify({ v: 1, resume: details || {}, avant: avant || null, apres: apres || null }),
      date,
    ]
  );
}

/* --- Photos --------------------------------------------------------------- */

function copierVersUploads(source, sousDossier, nomFichier) {
  if (!source) return null;
  const dossier = path.join(config.uploadsDir, sousDossier);
  fs.mkdirSync(dossier, { recursive: true });
  const extension = path.extname(source) || '.jpg';
  const destination = path.join(dossier, `${nomFichier}${extension}`);
  fs.copyFileSync(source, destination);
  return `uploads/${sousDossier}/${nomFichier}${extension}`;
}

/* --- Nettoyage ------------------------------------------------------------ */

async function vider(client) {
  log('Nettoyage des donnees existantes...');
  // Ordre impose par les cles etrangeres. Le compte administrateur et les
  // parametres sont conserves : ce sont eux qui permettent de se connecter.
  await client.query(`
    TRUNCATE paie_versements, paie_lignes, paie_cycles,
             employes_documents_fichiers, employes_documents,
             employes_carriere, ventes_lignes, ventes, mouvements_stock,
             lots_stock, historique_prix, depenses, vendeuses, employes,
             fonctions, produits, fournisseurs, historique_audit
    RESTART IDENTITY CASCADE
  `);

  // Les fichiers copies lors d'un remplissage precedent : sans ce menage, le
  // dossier grossit a chaque execution avec des images qui ne sont plus
  // referencees nulle part.
  // Seuls les fichiers partent : effacer le dossier entier emportait aussi le
  // `.gitkeep` qui le maintient dans le depot, et le prochain deploiement se
  // retrouvait sans dossier ou ecrire.
  for (const sous of ['employes', 'produits', 'documents']) {
    const dossier = path.join(config.uploadsDir, sous);
    if (!fs.existsSync(dossier)) continue;
    for (const entree of fs.readdirSync(dossier)) {
      if (entree === '.gitkeep') continue;
      fs.rmSync(path.join(dossier, entree), { recursive: true, force: true });
    }
  }
}

/* --- Etablissement, fonctions, references --------------------------------- */

async function poserEtablissement(client) {
  const colonnes = Object.keys(D.ETABLISSEMENT);
  const affectations = colonnes.map((c, i) => `${c} = $${i + 1}`).join(', ');
  await client.query(
    `UPDATE parametres SET ${affectations} WHERE id = 1`,
    colonnes.map((c) => D.ETABLISSEMENT[c])
  );
  log(`Etablissement : ${D.ETABLISSEMENT.etablissement_nom}`);
}

async function creerFonctions(client, adminId) {
  const parNom = new Map();
  for (const f of D.FONCTIONS) {
    const { rows } = await client.query(
      'INSERT INTO fonctions (nom, description, created_at) VALUES ($1, $2, $3) RETURNING *',
      [f.nom, f.description, `${D.DEBUT}T08:00:00`]
    );
    parNom.set(f.nom, rows[0]);
  }
  await audit(client, {
    type: 'fonction_creation', utilisateurId: adminId, date: `${D.DEBUT}T08:05:00`,
    details: { nombre: D.FONCTIONS.length },
  });
  log(`Fonctions : ${parNom.size}`);
  return parNom;
}

async function creerFournisseurs(client, adminId) {
  const liste = [];
  for (const [i, f] of D.FOURNISSEURS.entries()) {
    const date = `${jour(ajouterJours(new Date(D.DEBUT), i * 3))}T09:${String(10 + i).padStart(2, '0')}:00`;
    const { rows } = await client.query(
      'INSERT INTO fournisseurs (nom, contact, created_at) VALUES ($1, $2, $3) RETURNING *',
      [f.nom, f.contact, date]
    );
    liste.push(rows[0]);
    await audit(client, {
      type: 'fournisseur_creation', entiteId: rows[0].id, utilisateurId: adminId, date,
      details: { nom: f.nom }, apres: { nom: f.nom, contact: f.contact, actif: true },
    });
  }
  log(`Fournisseurs : ${liste.length}`);
  return liste;
}

/* --- Employes ------------------------------------------------------------- */

async function creerEmployes(client, adminId, fonctions, photos) {
  const liste = [];

  for (const [index, e] of D.EMPLOYES.entries()) {
    const matricule = await genererMatriculeUnique(client);
    const photo = copierVersUploads(photos.get(`portrait-${index}`), 'employes', `employe-${index + 1}`);
    const horodatage = `${e.embauche}T08:${String(20 + (index % 30)).padStart(2, '0')}:00`;

    const { rows } = await client.query(
      `INSERT INTO employes
         (matricule, prenom, nom, sexe, date_naissance, telephone, ville, quartier,
          numero_cni, type_contrat, date_embauche, photo,
          urgence_nom, urgence_telephone, urgence_lien,
          nationalite, adresse, email, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
       RETURNING *`,
      [
        matricule, e.prenom, e.nom, e.sexe, e.naissance, e.telephone, e.ville, e.quartier,
        e.cni, e.contrat, e.embauche, photo,
        e.urgence?.[0] || null, e.urgence?.[1] || null, e.urgence?.[2] || null,
        'Camerounaise', `${e.quartier}, ${e.ville}`,
        `${e.prenom.toLowerCase()}.${e.nom.toLowerCase().replace(/[^a-z]/g, '')}@mail.cm`,
        horodatage,
      ]
    );
    const employe = rows[0];

    // Carriere : la premiere periode part de l'embauche, les suivantes ferment
    // la precedente la veille - exactement comme le fait l'application.
    const etapes = [
      { date: e.embauche, salaire: e.salaire, fonction: e.fonction, motif: 'Embauche' },
      ...(e.carriere || []),
    ];
    let precedente = null;
    for (const etape of etapes) {
      const fonctionNom = etape.fonction || precedente?.fonctionNom || e.fonction;
      const fonction = fonctions.get(fonctionNom);
      if (precedente) {
        await client.query(
          "UPDATE employes_carriere SET date_fin = ($1::date - INTERVAL '1 day')::date WHERE id = $2",
          [etape.date, precedente.id]
        );
      }
      const { rows: cr } = await client.query(
        `INSERT INTO employes_carriere
           (employe_id, montant, fonction, fonction_id, date_debut, motif, auteur_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [employe.id, etape.salaire, fonction.nom, fonction.id, etape.date, etape.motif, adminId,
          `${etape.date}T08:30:00`]
      );
      await audit(client, {
        type: precedente ? 'employe_carriere_ajout' : 'employe_creation',
        entiteId: employe.id, utilisateurId: adminId, date: `${etape.date}T08:30:00`,
        details: precedente
          ? { motif: etape.motif, date_debut: etape.date }
          : { matricule, nom_complet: `${e.prenom} ${e.nom}` },
        avant: precedente ? { montant: precedente.montant, fonction: precedente.fonctionNom } : null,
        apres: { montant: etape.salaire, fonction: fonction.nom },
      });
      precedente = { id: cr[0].id, montant: etape.salaire, fonctionNom: fonction.nom };
    }

    liste.push({ ...employe, config: e });
  }

  log(`Employes : ${liste.length}`);
  return liste;
}

async function creerVendeuses(client, adminId, employes) {
  const liste = [];
  for (const employe of employes) {
    if (!employe.config.vendeuse) continue;
    // Le code est attribue quelques jours apres l'embauche, le temps de la
    // formation : c'est ce qui se passe reellement.
    const date = jour(ajouterJours(new Date(employe.date_embauche), entre(2, 10)));
    // Code a six chiffres, unique : meme forme que celui produit par
    // l'application, tire ici pour pouvoir dater sa creation.
    let code;
    do {
      code = String(entre(100000, 999999));
      // eslint-disable-next-line no-await-in-loop
    } while ((await client.query('SELECT 1 FROM vendeuses WHERE code = $1', [code])).rows.length);

    const { rows } = await client.query(
      `INSERT INTO vendeuses (nom, contact, code, employe_id, created_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [`${employe.prenom} ${employe.nom}`, employe.telephone, code, employe.id, `${date}T09:00:00`]
    );
    liste.push({ ...rows[0], employe });
    await audit(client, {
      type: 'vendeuse_creation', entiteId: rows[0].id, utilisateurId: adminId,
      date: `${date}T09:00:00`,
      details: { vendeuse_nom: rows[0].nom, employe_id: employe.id },
      apres: { nom: rows[0].nom, contact: rows[0].contact, actif: true },
    });
  }
  log(`Vendeuses : ${liste.length}`);
  return liste;
}

/* --- Produits ------------------------------------------------------------- */

async function creerProduits(client, adminId, photos) {
  const liste = [];
  for (const [index, p] of D.PRODUITS.entries()) {
    // Le catalogue se constitue sur les premieres semaines, pas en un jour.
    const date = jour(ajouterJours(new Date(D.DEBUT), Math.floor(index / 6) * 4));
    const photo = copierVersUploads(photos.get(`produit-${index}`), 'produits', `produit-${index + 1}`);

    const { rows } = await client.query(
      `INSERT INTO produits (nom, prix_vente, unite_stock, unite_achat, facteur_conversion,
                             seuil_alerte, photo, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [p.nom, p.prix, 'piece', 'carton', 12, p.seuil, photo, `${date}T10:00:00`]
    );
    liste.push({ ...rows[0], config: p, stock: 0 });
    await audit(client, {
      type: 'produit_creation', entiteId: rows[0].id, utilisateurId: adminId, date: `${date}T10:00:00`,
      details: { nom: p.nom }, apres: { nom: p.nom, prix_vente: p.prix, unite_stock: 'piece' },
    });
  }
  log(`Produits : ${liste.length}`);
  return liste;
}

/* --- Operations de stock -------------------------------------------------- */

// Reassort : cree un lot FIFO, met a jour le cout moyen pondere et trace le
// mouvement. Reproduit fidelement `entreeStock`, avec une date choisie.
async function entree(client, produit, quantite, coutTotal, fournisseurId, horodatage, adminId) {
  const coutUnitaire = coutTotal / quantite;

  await client.query(
    `INSERT INTO lots_stock (produit_id, quantite_initiale, quantite_restante, cout_unitaire,
                             fournisseur_id, date_entree)
     VALUES ($1,$2,$2,$3,$4,$5)`,
    [produit.id, quantite, coutUnitaire, fournisseurId, horodatage]
  );

  const stockAvant = produit.stock;
  const cmpAvant = produit.cmp || 0;
  produit.stock += quantite;
  produit.cmp = produit.stock > 0
    ? (stockAvant * cmpAvant + quantite * coutUnitaire) / produit.stock
    : 0;

  await client.query(
    'UPDATE produits SET quantite_stock = $1, cout_moyen_pondere = $2, updated_at = $3 WHERE id = $4',
    [produit.stock, produit.cmp, horodatage, produit.id]
  );
  await client.query(
    `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, auteur_id,
                                   fournisseur_id, motif, date)
     VALUES ($1,'entree',$2,$3,$4,$5,'ravitaillement',$6)`,
    [produit.id, quantite, coutUnitaire, adminId, fournisseurId, horodatage]
  );
  await audit(client, {
    type: 'entree_stock', entiteId: produit.id, utilisateurId: adminId, date: horodatage,
    details: { produit_nom: produit.nom, quantite_achat: quantite / 12, cout_achat_total: coutTotal },
    avant: { quantite_stock: stockAvant, cout_moyen_pondere: cmpAvant, unite_stock: 'piece' },
    apres: { quantite_stock: produit.stock, cout_moyen_pondere: produit.cmp, unite_stock: 'piece' },
  });
}

// Consomme les lots au plus ancien et renvoie le cout unitaire applique.
// C'est le coeur de la valorisation : si cette fonction se trompe, toutes les
// marges des rapports sont fausses.
async function consommerLots(client, produitId, quantite) {
  const { rows: lots } = await client.query(
    `SELECT id, quantite_restante, cout_unitaire FROM lots_stock
      WHERE produit_id = $1 AND quantite_restante > 0
      ORDER BY date_entree ASC, id ASC`,
    [produitId]
  );
  let restant = quantite;
  let coutTotal = 0;
  for (const lot of lots) {
    if (restant <= 0) break;
    const pris = Math.min(restant, Number(lot.quantite_restante));
    coutTotal += pris * Number(lot.cout_unitaire);
    restant -= pris;
    await client.query(
      'UPDATE lots_stock SET quantite_restante = quantite_restante - $1 WHERE id = $2',
      [pris, lot.id]
    );
  }
  if (restant > 0.005) {
    throw new Error(`Lots insuffisants pour le produit ${produitId} (manque ${restant})`);
  }
  return coutTotal / quantite;
}

async function ajustement(client, produit, quantiteCible, motif, note, horodatage, adminId) {
  const ecart = quantiteCible - produit.stock;
  if (Math.abs(ecart) < 0.005) return;

  let coutUnitaire = produit.cmp || 0;
  if (ecart < 0) {
    coutUnitaire = await consommerLots(client, produit.id, -ecart);
  } else {
    await client.query(
      `INSERT INTO lots_stock (produit_id, quantite_initiale, quantite_restante, cout_unitaire, date_entree)
       VALUES ($1,$2,$2,$3,$4)`,
      [produit.id, ecart, produit.cmp || 0, horodatage]
    );
  }

  const avant = produit.stock;
  produit.stock = quantiteCible;
  await client.query('UPDATE produits SET quantite_stock = $1, updated_at = $2 WHERE id = $3',
    [produit.stock, horodatage, produit.id]);
  await client.query(
    `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, auteur_id, motif, note, date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [produit.id, ecart > 0 ? 'entree' : 'sortie', Math.abs(ecart), coutUnitaire, adminId, motif, note, horodatage]
  );
  await audit(client, {
    type: 'ajustement_stock', entiteId: produit.id, utilisateurId: adminId, date: horodatage,
    details: {
      produit_nom: produit.nom, motif, note, ecart,
      valeur_ecart: Math.abs(ecart) * coutUnitaire,
    },
    avant: { quantite_stock: avant, unite_stock: 'piece' },
    apres: { quantite_stock: quantiteCible, unite_stock: 'piece' },
  });
}

/* --- Ventes --------------------------------------------------------------- */

async function vente(client, produits, vendeusesActives, horodatage, adminId) {
  // Un panier de parfumerie compte rarement plus de quatre articles.
  const nombreLignes = chance(0.55) ? 1 : (chance(0.6) ? 2 : entre(3, 4));

  // Le tirage est pondere par la rotation : sans cela, le coffret Prestige a
  // 85 000 F se vendrait aussi souvent que le deodorant a 4 500 F, et les
  // classements de produits n'apprendraient rien.
  const disponibles = produits.filter((p) => p.stock >= 1);
  if (!disponibles.length) return null;

  const choisis = new Map();
  for (let i = 0; i < nombreLignes; i += 1) {
    const poids = disponibles.reduce((s, p) => s + p.config.rotation, 0);
    let tirage = alea() * poids;
    const produit = disponibles.find((p) => (tirage -= p.config.rotation) <= 0) || disponibles[0];
    const quantite = chance(0.78) ? 1 : entre(2, 3);
    if (produit.stock < (choisis.get(produit)?.quantite || 0) + quantite) continue;
    const existant = choisis.get(produit);
    if (existant) existant.quantite += quantite;
    else choisis.set(produit, { quantite });
  }
  if (!choisis.size) return null;

  // Environ deux ventes sur cinq sont attribuees a une vendeuse ; le reste est
  // encaisse au comptoir sans attribution.
  const vendeuse = vendeusesActives.length && chance(0.42) ? parmi(vendeusesActives) : null;

  const { rows: venteRows } = await client.query(
    `INSERT INTO ventes (type, vendeuse_id, montant_total, auteur_id, date)
     VALUES ($1,$2,0,$3,$4) RETURNING *`,
    [vendeuse ? 'vendeuse' : 'directe', vendeuse?.id || null, adminId, horodatage]
  );
  const venteId = venteRows[0].id;

  let total = 0;
  for (const [produit, { quantite }] of choisis) {
    const coutUnitaire = await consommerLots(client, produit.id, quantite);
    produit.stock -= quantite;
    await client.query(
      'UPDATE produits SET quantite_stock = $1, updated_at = $2 WHERE id = $3',
      [produit.stock, horodatage, produit.id]
    );
    await client.query(
      `INSERT INTO ventes_lignes (vente_id, produit_id, quantite, prix_vente_snapshot, cout_acquisition_snapshot)
       VALUES ($1,$2,$3,$4,$5)`,
      [venteId, produit.id, quantite, produit.prix_vente, coutUnitaire]
    );
    await client.query(
      `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, vente_id, auteur_id, motif, date)
       VALUES ($1,'sortie',$2,$3,$4,$5,'vente',$6)`,
      [produit.id, quantite, coutUnitaire, venteId, adminId, horodatage]
    );
    total += Number(produit.prix_vente) * quantite;
  }

  await client.query('UPDATE ventes SET montant_total = $1 WHERE id = $2', [total, venteId]);
  await audit(client, {
    type: 'vente_creation', entiteId: venteId, utilisateurId: adminId, date: horodatage,
    details: {
      type: vendeuse ? 'vendeuse' : 'directe',
      montant_total: total,
      vendeuse_nom: vendeuse?.nom || null,
    },
  });
  return total;
}

/* --- Simulation jour par jour --------------------------------------------- */

// Coefficient d'activite : decembre et fevrier portent les fetes et la
// Saint-Valentin, aout est creux. Une courbe plate sur trente mois se voit
// immediatement et ne ressemble a aucun commerce.
function saison(date) {
  const mois = date.getMonth();
  if (mois === 11) return 1.9;
  if (mois === 1) return 1.45;
  if (mois === 0) return 0.85;
  if (mois === 7) return 0.8;
  if (mois === 3 || mois === 4) return 1.15;
  return 1;
}

function coefficientJour(date) {
  const j = date.getDay();
  if (j === 0) return 0.35;
  if (j === 6) return 1.5;
  if (j === 5) return 1.25;
  return 1;
}

async function simuler(client, contexte) {
  const { produits, vendeuses, fournisseurs, adminId, employes } = contexte;
  const fin = new Date();
  let date = new Date(D.DEBUT);

  let nbVentes = 0;
  let nbEntrees = 0;
  let nbAjustements = 0;
  let nbDepenses = 0;
  let moisCourant = -1;

  while (date <= fin) {
    const cle = jour(date);
    const mois = date.getMonth();

    // Nouveau mois : depenses recurrentes.
    if (mois !== moisCourant) {
      moisCourant = mois;
      nbDepenses += await depensesDuMois(client, date, adminId);
    }

    // Produits deja au catalogue a cette date.
    const catalogue = produits.filter((p) => jour(new Date(p.created_at)) <= cle);

    // Reassort : on commande ce qui approche du seuil. Le magasinier ne
    // recommande pas tout le meme jour, d'ou le tirage.
    //
    // Quelques references cessent d'etre reapprovisionnees dans les dernieres
    // semaines : rupture chez le fournisseur, article en fin de vie. Sans cela
    // le stock serait partout au-dessus du seuil et l'ecran d'alertes
    // paraitrait mort, alors que c'est justement l'etat qu'un gerant surveille.
    const joursDepuisFin = Math.round((fin - date) / 86400000);
    for (const produit of catalogue) {
      if (produit.stock > produit.config.seuil * 1.6) continue;
      if (joursDepuisFin < 55 && produit.id % 5 === 0) continue;
      if (!chance(0.5)) continue;
      const cartons = entre(2, 6);
      const quantite = cartons * 12;
      // Le prix d'achat derive legerement au fil des mois, comme un vrai
      // approvisionnement soumis au change et au transport.
      const derive = 1 + (alea() - 0.42) * 0.18;
      const coutTotal = Math.round(quantite * produit.config.achat * derive);
      await entree(client, produit, quantite, coutTotal, parmi(fournisseurs).id,
        heureOuvrable(date, 7, 4), adminId);
      nbEntrees += 1;
    }

    // Vendeuses en poste ce jour-la : une vendeuse partie ne doit plus
    // apparaitre sur une vente posterieure a son depart.
    const vendeusesActives = vendeuses.filter((v) => {
      const emp = v.employe.config;
      if (emp.embauche > cle) return false;
      if (emp.depart && emp.depart.date < cle) return false;
      return jour(new Date(v.created_at)) <= cle;
    });

    // Ventes du jour.
    const base = 6 * saison(date) * coefficientJour(date);
    const nombre = Math.max(0, Math.round(base + (alea() - 0.5) * 4));
    for (let i = 0; i < nombre; i += 1) {
      const montant = await vente(client, catalogue, vendeusesActives, heureOuvrable(date), adminId);
      if (montant !== null) nbVentes += 1;
    }

    // Casse, perte, inventaire : environ une fois par semaine.
    if (chance(0.14) && catalogue.length) {
      const produit = parmi(catalogue.filter((p) => p.stock > 3) || catalogue);
      if (produit && produit.stock > 3) {
        const cas = parmi([
          { motif: 'casse', note: 'Flacon brise lors de la mise en rayon', perte: entre(1, 2) },
          { motif: 'casse', note: 'Carton tombe a la reception', perte: entre(1, 3) },
          { motif: 'perte', note: 'Article perime retire de la vente', perte: 1 },
          { motif: 'vol', note: 'Disparition constatee en fin de journee', perte: 1 },
          { motif: 'inventaire', note: 'Ecart constate au comptage des rayons', perte: entre(1, 2) },
        ]);
        await ajustement(client, produit, produit.stock - cas.perte, cas.motif, cas.note,
          heureOuvrable(date, 17, 2), adminId);
        nbAjustements += 1;
      }
    }

    // Un inventaire complet en fin d'annee, sur un echantillon de produits.
    if (date.getMonth() === 11 && date.getDate() === 28) {
      for (const produit of catalogue.filter(() => chance(0.3))) {
        if (produit.stock < 2) continue;
        const ecart = chance(0.5) ? -1 : 1;
        await ajustement(client, produit, produit.stock + ecart, 'inventaire',
          'Inventaire annuel de fin d\'annee', heureOuvrable(date, 16, 2), adminId);
        nbAjustements += 1;
      }
    }

    date = ajouterJours(date, 1);
  }

  log(`Ventes : ${nbVentes} | Entrees de stock : ${nbEntrees} | Ajustements : ${nbAjustements} | Depenses : ${nbDepenses}`);
  return { nbVentes, nbEntrees, nbAjustements, nbDepenses };
}

/* --- Depenses ------------------------------------------------------------- */

async function depensesDuMois(client, date, adminId) {
  let compte = 0;
  for (const categorie of D.CATEGORIES_DEPENSE) {
    const tirages = categorie.frequence === 'mensuel' ? 1
      : categorie.frequence === 'frequent' ? entre(2, 5)
        : (chance(0.45) ? 1 : 0);

    for (let i = 0; i < tirages; i += 1) {
      const jourDuMois = categorie.jour || entre(1, 27);
      const quand = new Date(date.getFullYear(), date.getMonth(), jourDuMois);
      if (quand > new Date()) continue;
      const [min, max] = categorie.montant;
      const montant = min === max ? min : entre(min, max);
      const horodatage = heureOuvrable(quand, 9, 8);

      const { rows } = await client.query(
        `INSERT INTO depenses (categorie, montant, note, auteur_id, date)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [categorie.nom, montant, null, adminId, horodatage]
      );
      await audit(client, {
        type: 'depense_creation', entiteId: rows[0].id, utilisateurId: adminId, date: horodatage,
        details: { categorie: categorie.nom, montant },
        apres: { categorie: categorie.nom, montant },
      });
      compte += 1;
    }
  }
  return compte;
}

/* --- Paie ----------------------------------------------------------------- */

async function salaireALaDate(client, employeId, date) {
  const { rows } = await client.query(
    `SELECT * FROM employes_carriere
      WHERE employe_id = $1 AND date_debut <= $2 AND (date_fin IS NULL OR date_fin >= $2)
      ORDER BY date_debut DESC LIMIT 1`,
    [employeId, date]
  );
  return rows[0] || null;
}

const MOIS_NOM = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

async function creerPaie(client, employes, adminId) {
  const aujourdhui = new Date();
  let curseur = new Date(2024, 0, 1);
  let nbCycles = 0;
  let nbLignes = 0;
  let nbVersements = 0;

  while (curseur < aujourdhui) {
    const annee = curseur.getFullYear();
    const mois = curseur.getMonth();
    const debutPeriode = jour(new Date(annee, mois, 1));
    const finPeriode = jour(new Date(annee, mois + 1, 0));

    // Le mois en cours n'est pas encore paye : on s'arrete au mois precedent.
    if (new Date(finPeriode) >= aujourdhui) break;

    // Prime generale en decembre, retenue exceptionnelle une fois pour montrer
    // les deux sens.
    let ajustement = null;
    if (mois === 11) {
      ajustement = { sens: 'augmentation', mode: 'pourcentage', valeur: 25, motif: 'Prime de fin d\'annee' };
    } else if (annee === 2025 && mois === 8) {
      ajustement = { sens: 'diminution', mode: 'montant', valeur: 5000, motif: 'Participation aux frais de tenue' };
    }

    const reference = await genererReferenceCycleUnique(client);
    const dateCreation = `${jour(new Date(annee, mois + 1, 1))}T08:30:00`;

    const { rows: cycleRows } = await client.query(
      `INSERT INTO paie_cycles
         (reference, libelle, periode_debut, periode_fin,
          ajustement_sens, ajustement_mode, ajustement_valeur, ajustement_motif,
          statut, auteur_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        reference, `Salaires ${MOIS_NOM[mois]} ${annee}`, debutPeriode, finPeriode,
        ajustement?.sens || null, ajustement?.mode || null, ajustement?.valeur || null,
        ajustement?.motif || null,
        'ouvert', adminId, dateCreation,
      ]
    );
    const cycle = cycleRows[0];
    nbCycles += 1;

    let effectif = 0;
    for (const employe of employes) {
      const e = employe.config;
      // Present pendant la periode : embauche avant la fin, depart apres le debut.
      if (e.embauche > finPeriode) continue;
      if (e.depart && e.depart.date < debutPeriode) continue;

      const carriere = await salaireALaDate(client, employe.id, finPeriode);
      if (!carriere) continue;

      const base = Number(carriere.montant);
      const general = ajustement
        ? (ajustement.sens === 'diminution' ? -1 : 1)
          * (ajustement.mode === 'pourcentage' ? (base * ajustement.valeur) / 100 : ajustement.valeur)
        : 0;

      // Retenue ponctuelle : avance sur salaire, absence, participation.
      let particulier = 0;
      let motifParticulier = null;
      if (chance(0.09)) {
        const cas = parmi([
          { montant: -entre(10000, 40000), motif: 'Avance sur salaire deja versee' },
          { montant: -entre(5000, 15000), motif: 'Absence non justifiee' },
          { montant: entre(10000, 30000), motif: 'Prime de performance' },
          { montant: -entre(8000, 20000), motif: 'Retenue sur ecart de caisse' },
        ]);
        particulier = cas.montant;
        motifParticulier = cas.motif;
      }

      const net = Math.max(0, Number((base + general + particulier).toFixed(2)));

      const { rows: ligneRows } = await client.query(
        `INSERT INTO paie_lignes
           (cycle_id, employe_id, matricule_snapshot, nom_complet_snapshot, fonction_snapshot,
            salaire_base, ajustement_general, ajustement_particulier, ajustement_motif,
            net_a_payer, montant_paye, statut)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'non_paye') RETURNING *`,
        [
          cycle.id, employe.id, employe.matricule, `${employe.prenom} ${employe.nom}`,
          carriere.fonction, base, general, particulier, motifParticulier, net,
        ]
      );
      const ligne = ligneRows[0];
      nbLignes += 1;
      effectif += 1;

      // Paiement : la plupart sont soldes dans les jours qui suivent, quelques
      // uns en deux fois, et de rares lignes restent en attente sur les mois
      // recents - ce qui est exactement l'etat d'une paie en cours.
      const moisEcoules = (aujourdhui.getFullYear() - annee) * 12 + (aujourdhui.getMonth() - mois);
      const resteEnAttente = moisEcoules <= 1 && chance(0.35);
      if (resteEnAttente || net === 0) continue;

      const enDeuxFois = chance(0.16);
      const premierJour = entre(1, 4);
      const versements = enDeuxFois
        ? [
          { montant: Math.round(net * (0.4 + alea() * 0.2)), decalage: premierJour },
          { montant: null, decalage: premierJour + entre(4, 12) },
        ]
        : [{ montant: net, decalage: premierJour }];

      let cumul = 0;
      for (const [i, v] of versements.entries()) {
        const montant = v.montant === null ? net - cumul : Math.min(v.montant, net - cumul);
        if (montant <= 0) continue;
        const quand = new Date(annee, mois + 1, v.decalage);
        if (quand > aujourdhui) break;

        cumul += montant;
        const estSolde = cumul >= net - 0.005;
        const numero = await genererNumeroRecuUnique(client);
        const horodatage = heureOuvrable(quand, 9, 7);

        await client.query(
          `INSERT INTO paie_versements
             (ligne_id, numero_recu, montant, mode_paiement, note, est_solde, auteur_id, paye_le)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            ligne.id, numero, montant,
            parmi(['especes', 'especes', 'mobile money', 'virement']),
            i === 0 && enDeuxFois ? 'Acompte' : null,
            estSolde, adminId, horodatage,
          ]
        );
        await client.query(
          'UPDATE paie_lignes SET montant_paye = $1, statut = $2 WHERE id = $3',
          [cumul, estSolde ? 'paye' : 'partiel', ligne.id]
        );
        await audit(client, {
          type: 'paie_versement', entiteId: cycle.id, utilisateurId: adminId, date: horodatage,
          details: {
            numero_recu: numero, nom_complet: `${employe.prenom} ${employe.nom}`,
            matricule: employe.matricule, montant, est_solde: estSolde,
          },
        });
        nbVersements += 1;
      }
    }

    await audit(client, {
      type: 'paie_cycle_creation', entiteId: cycle.id, utilisateurId: adminId, date: dateCreation,
      details: { reference, libelle: cycle.libelle, effectif },
      apres: { reference, periode_debut: debutPeriode, periode_fin: finPeriode },
    });

    // Les cycles anterieurs au mois dernier sont clotures : une paie de 2024
    // qu'on pourrait encore modifier n'aurait aucun sens.
    const moisEcoules = (aujourdhui.getFullYear() - annee) * 12 + (aujourdhui.getMonth() - mois);
    if (moisEcoules > 2) {
      await client.query("UPDATE paie_cycles SET statut = 'cloture' WHERE id = $1", [cycle.id]);
    }

    curseur = new Date(annee, mois + 1, 1);
  }

  log(`Paie : ${nbCycles} cycles | ${nbLignes} lignes | ${nbVersements} versements`);
  return { nbCycles, nbLignes, nbVersements };
}

/* --- Documents ------------------------------------------------------------ */

async function creerDocuments(client, employes, adminId, photos) {
  let nbDocuments = 0;
  let nbFichiers = 0;

  for (const [index, employe] of employes.entries()) {
    for (const [rang, type] of D.DOCUMENTS_TYPES.entries()) {
      if (!type.pourTous && !chance(type.proportion)) continue;

      const date = jour(ajouterJours(new Date(employe.date_embauche), entre(0, 20)));
      const horodatage = `${date}T11:${String(10 + rang).padStart(2, '0')}:00`;

      const { rows } = await client.query(
        `INSERT INTO employes_documents (employe_id, nom, categorie, note, auteur_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [employe.id, type.nom, type.categorie, null, adminId, horodatage]
      );
      const document = rows[0];
      nbDocuments += 1;

      const dossier = path.join(config.uploadsDir, 'documents', String(document.id));
      fs.mkdirSync(dossier, { recursive: true });

      for (let page = 0; page < type.pages; page += 1) {
        const source = photos.get(`doc-${index}-${rang}-${page}`);
        if (!source) continue;
        const nomFichier = `piece-${document.id}-${page}.jpg`;
        fs.copyFileSync(source, path.join(dossier, nomFichier));
        const taille = fs.statSync(path.join(dossier, nomFichier)).size;

        await client.query(
          `INSERT INTO employes_documents_fichiers
             (document_id, chemin, nom_original, type_mime, taille_octets, taille_origine, ordre, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            document.id, `uploads/documents/${document.id}/${nomFichier}`,
            `${type.nom.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-page-${page + 1}.jpg`,
            'image/jpeg', taille,
            // Taille "avant reduction" : ces images ont ete reduites a la
            // source, on inscrit une valeur coherente plutot que d'annoncer un
            // gain qui n'a pas eu lieu.
            Math.round(taille * (2.4 + alea() * 3)),
            page, horodatage,
          ]
        );
        nbFichiers += 1;
      }

      await audit(client, {
        type: 'employe_document_ajout', entiteId: employe.id, utilisateurId: adminId, date: horodatage,
        details: { matricule: employe.matricule, nom_document: type.nom, nombre_fichiers: type.pages },
      });
    }
  }

  log(`Documents : ${nbDocuments} dossiers | ${nbFichiers} fichiers`);
  return { nbDocuments, nbFichiers };
}

/* --- Departs et blocages -------------------------------------------------- */

// Applique en dernier, une fois toute l'activite simulee : bloquer plus tot
// aurait exclu ces personnes des cycles de paie auxquels elles avaient droit.
async function appliquerDeparts(client, employes, adminId) {
  let compte = 0;
  for (const employe of employes) {
    const depart = employe.config.depart;
    if (!depart) continue;

    const horodatage = `${depart.date}T17:30:00`;
    await client.query(
      `UPDATE employes
          SET actif = false, motif_blocage = $1, bloque_le = $2, bloque_par = $3,
              date_sortie = $4, motif_sortie = $1, updated_at = $2
        WHERE id = $5`,
      [depart.motif, horodatage, adminId, depart.date, employe.id]
    );
    // Le blocage porte partout : le code de vente est refuse en caisse des cet
    // instant, la personne disparait des badges et des cycles a venir.
    await client.query('UPDATE vendeuses SET actif = false WHERE employe_id = $1', [employe.id]);

    await audit(client, {
      type: 'employe_blocage', entiteId: employe.id, utilisateurId: adminId, date: horodatage,
      details: {
        matricule: employe.matricule,
        nom_complet: `${employe.prenom} ${employe.nom}`,
        motif: depart.motif,
      },
      avant: { actif: true },
      apres: { actif: false, motif_blocage: depart.motif },
    });
    compte += 1;
  }
  log(`Blocages appliques : ${compte}`);
  return compte;
}

/* --- Controles ------------------------------------------------------------ */

// Le remplissage ne vaut rien s'il laisse le systeme incoherent. Ces controles
// sont les memes que ceux de `npm run check-integrity`, plus ceux propres a la
// paie.
async function verifier(client) {
  const problemes = [];

  const { rows: stock } = await client.query(
    `SELECT p.id, p.nom, p.quantite_stock, COALESCE(SUM(l.quantite_restante), 0) AS lots
       FROM produits p LEFT JOIN lots_stock l ON l.produit_id = p.id
      GROUP BY p.id
     HAVING ABS(p.quantite_stock - COALESCE(SUM(l.quantite_restante), 0)) > 0.005`
  );
  for (const r of stock) problemes.push(`Stock incoherent : ${r.nom} (${r.quantite_stock} vs ${r.lots} en lots)`);

  const { rows: negatifs } = await client.query('SELECT nom FROM produits WHERE quantite_stock < 0');
  for (const r of negatifs) problemes.push(`Stock negatif : ${r.nom}`);

  const { rows: paie } = await client.query(
    `SELECT l.id, l.nom_complet_snapshot, l.montant_paye, COALESCE(SUM(v.montant), 0) AS verse
       FROM paie_lignes l LEFT JOIN paie_versements v ON v.ligne_id = l.id
      GROUP BY l.id
     HAVING ABS(l.montant_paye - COALESCE(SUM(v.montant), 0)) > 0.005`
  );
  for (const r of paie) problemes.push(`Paie incoherente : ${r.nom_complet_snapshot} (${r.montant_paye} vs ${r.verse})`);

  const { rows: surpaye } = await client.query(
    'SELECT nom_complet_snapshot FROM paie_lignes WHERE montant_paye > net_a_payer + 0.005'
  );
  for (const r of surpaye) problemes.push(`Trop-percu : ${r.nom_complet_snapshot}`);

  const { rows: chevauchements } = await client.query(
    `SELECT a.employe_id, count(*)::int AS n
       FROM employes_carriere a JOIN employes_carriere b
         ON a.employe_id = b.employe_id AND a.id <> b.id
        AND a.date_debut <= COALESCE(b.date_fin, '9999-12-31')
        AND COALESCE(a.date_fin, '9999-12-31') >= b.date_debut
      GROUP BY a.employe_id`
  );
  for (const r of chevauchements) problemes.push(`Periodes de carriere qui se chevauchent : employe ${r.employe_id}`);

  const { rows: ventesFausses } = await client.query(
    `SELECT v.id FROM ventes v
       JOIN (SELECT vente_id, SUM(quantite * prix_vente_snapshot) AS total
               FROM ventes_lignes GROUP BY vente_id) t ON t.vente_id = v.id
      WHERE ABS(v.montant_total - t.total) > 0.005`
  );
  for (const r of ventesFausses) problemes.push(`Montant de vente incoherent : vente ${r.id}`);

  return problemes;
}

/* --- Orchestration -------------------------------------------------------- */

async function principal() {
  const client = await pool.connect();
  try {
    const { rows: admins } = await client.query(
      "SELECT id FROM utilisateurs WHERE role = 'admin' ORDER BY id LIMIT 1"
    );
    if (!admins.length) throw new Error("Aucun compte administrateur : demarrez le serveur une fois d'abord.");
    const adminId = admins[0].id;

    log('Telechargement des photos (mises en cache apres le premier passage)...');
    const demandes = [];
    D.EMPLOYES.forEach((e, i) => demandes.push({ cle: `portrait-${i}`, url: urlPortrait(e.sexe, e.portrait) }));
    D.PRODUITS.forEach((p, i) => demandes.push({ cle: `produit-${i}`, url: urlPhoto(`machibel-produit-${i}`, 600, 600) }));
    D.EMPLOYES.forEach((e, i) => {
      D.DOCUMENTS_TYPES.forEach((t, r) => {
        for (let page = 0; page < t.pages; page += 1) {
          demandes.push({ cle: `doc-${i}-${r}-${page}`, url: urlPhoto(`machibel-doc-${i}-${r}-${page}`, 700, 950) });
        }
      });
    });
    const photos = await obtenirLot(demandes, { journal: log });
    log(`Photos disponibles : ${[...photos.values()].filter(Boolean).length} / ${demandes.length}`);

    await client.query('BEGIN');
    await vider(client);
    await poserEtablissement(client);
    const fonctions = await creerFonctions(client, adminId);
    const fournisseurs = await creerFournisseurs(client, adminId);
    const employes = await creerEmployes(client, adminId, fonctions, photos);
    const vendeuses = await creerVendeuses(client, adminId, employes);
    const produits = await creerProduits(client, adminId, photos);
    await client.query('COMMIT');

    log('Simulation jour par jour depuis le 2 janvier 2024...');
    await client.query('BEGIN');
    await simuler(client, { produits, vendeuses, fournisseurs, adminId, employes });
    await client.query('COMMIT');

    await client.query('BEGIN');
    await creerPaie(client, employes, adminId);
    await creerDocuments(client, employes, adminId, photos);
    await appliquerDeparts(client, employes, adminId);
    await client.query('COMMIT');

    log('Verification de coherence...');
    const problemes = await verifier(client);
    if (problemes.length) {
      log(`${problemes.length} PROBLEME(S) DETECTE(S) :`);
      problemes.slice(0, 20).forEach((p) => log(`  - ${p}`));
      process.exitCode = 1;
    } else {
      log('Coherence verifiee : stock, lots, paie, carriere et ventes concordent.');
    }

    const { rows: [bilan] } = await client.query(`
      SELECT (SELECT count(*) FROM employes) employes,
             (SELECT count(*) FROM employes WHERE actif = false) bloques,
             (SELECT count(*) FROM vendeuses) vendeuses,
             (SELECT count(*) FROM produits) produits,
             (SELECT count(*) FROM fournisseurs) fournisseurs,
             (SELECT count(*) FROM ventes) ventes,
             (SELECT count(*) FROM ventes_lignes) lignes_vente,
             (SELECT count(*) FROM mouvements_stock) mouvements,
             (SELECT count(*) FROM depenses) depenses,
             (SELECT count(*) FROM paie_cycles) cycles,
             (SELECT count(*) FROM paie_versements) recus,
             (SELECT count(*) FROM employes_documents) documents,
             (SELECT count(*) FROM employes_documents_fichiers) fichiers,
             (SELECT count(*) FROM historique_audit) audit,
             (SELECT COALESCE(SUM(montant_total),0) FROM ventes) ca,
             (SELECT COALESCE(SUM(montant),0) FROM paie_versements) masse_salariale
    `);
    log('--------------------------------------------------------');
    for (const [cle, valeur] of Object.entries(bilan)) {
      log(`  ${cle.padEnd(16)} ${valeur}`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

principal()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\nEchec du remplissage :', err.message);
    console.error(err.stack);
    await pool.end().catch(() => {});
    process.exit(1);
  });

