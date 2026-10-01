const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = require('../src/config/db');
const config = require('../src/config');
const { genererMatriculeUnique, genererReferenceCycleUnique, genererNumeroRecuUnique } = require('../src/utils/identifiants-rh');

const { obtenirLot, demandesPhotosDemo } = require('./lib/photos');
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

// Correspondance chemin depose dans uploads/ -> cle de l'image dans le lot
// versionne. Conservee en base a la fin du remplissage : sur un hebergement
// dont le disque est efface a chaque redemarrage, c'est elle qui permet de
// reposer les photos sans avoir a rejouer le remplissage.
let manifeste = {};

function copierVersUploads(source, sousDossier, nomFichier, cle) {
  if (!source) return null;
  const dossier = path.join(config.uploadsDir, sousDossier);
  fs.mkdirSync(dossier, { recursive: true });
  const extension = path.extname(source) || '.jpg';
  const relatif = `uploads/${sousDossier}/${nomFichier}${extension}`;
  fs.copyFileSync(source, path.join(dossier, `${nomFichier}${extension}`));
  if (cle) manifeste[relatif] = cle;
  return relatif;
}

/* --- Nettoyage ------------------------------------------------------------ */

async function vider(client, effacer) {
  // Mode complement : on ajoute le jeu de demonstration a cote de ce qui est
  // deja saisi, sans rien detruire. Les identifiants ne repartent pas de 1,
  // ce qui n'a aucune importance : tout le remplissage travaille avec les
  // identifiants reellement rendus par les INSERT, jamais avec des valeurs
  // supposees.
  if (!effacer) {
    log('Mode complement : les donnees existantes sont conservees.');
    return;
  }

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
    // `ON CONFLICT` plutot qu'un INSERT sec : en mode complement, la base
    // contient deja des fonctions saisies a la main, et un nom identique
    // heurterait l'index unique sur `lower(trim(nom))` - le remplissage
    // s'arreterait la, sur un doublon sans consequence.
    const { rows } = await client.query(
      `INSERT INTO fonctions (nom, description, created_at) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING *`,
      [f.nom, f.description, `${D.DEBUT}T08:00:00`]
    );
    if (rows[0]) {
      parNom.set(f.nom, rows[0]);
      continue;
    }
    const { rows: existante } = await client.query(
      'SELECT * FROM fonctions WHERE lower(trim(nom)) = lower(trim($1))',
      [f.nom]
    );
    parNom.set(f.nom, existante[0]);
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
    // Tous les fournisseurs ne sont pas la des le premier jour : on en trouve
    // de nouveaux au fil des annees.
    const date = f.arrivee
      ? `${f.arrivee}T09:${String(10 + i).padStart(2, '0')}:00`
      : `${jour(ajouterJours(new Date(D.DEBUT), i * 3))}T09:${String(10 + i).padStart(2, '0')}:00`;
    const { rows } = await client.query(
      'INSERT INTO fournisseurs (nom, contact, created_at) VALUES ($1, $2, $3) RETURNING *',
      [f.nom, f.contact, date]
    );
    liste.push(rows[0]);
    await audit(client, {
      type: 'fournisseur_creation', entiteId: rows[0].id, utilisateurId: adminId, date,
      details: { nom: f.nom }, apres: { nom: f.nom, contact: f.contact, actif: true },
    });
    liste[liste.length - 1].config = f;
  }
  log(`Fournisseurs : ${liste.length}`);
  return liste;
}

// Cessation de relation : le fournisseur n'est plus proposable a la reception,
// mais toutes ses entrees passees restent au journal.
async function arreterFournisseurs(client, fournisseurs, adminId) {
  let compte = 0;
  for (const f of fournisseurs) {
    if (!f.config?.fin) continue;
    const horodatage = `${f.config.fin.date}T16:00:00`;
    await client.query('UPDATE fournisseurs SET actif = false WHERE id = $1', [f.id]);
    await audit(client, {
      type: 'fournisseur_desactivation', entiteId: f.id, utilisateurId: adminId, date: horodatage,
      details: { nom: f.nom, motif: f.config.fin.motif },
      avant: { actif: true }, apres: { actif: false },
    });
    compte += 1;
  }
  log(`Fournisseurs desactives : ${compte}`);
}

/* --- Employes ------------------------------------------------------------- */

async function creerEmployes(client, adminId, fonctions, photos) {
  const liste = [];

  for (const [index, e] of D.EMPLOYES.entries()) {
    const matricule = await genererMatriculeUnique(client);
    const photo = copierVersUploads(
      photos.get(`portrait-${index}`), 'employes', `employe-${index + 1}`, `portrait-${index}`
    );
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
    // Le catalogue se constitue sur les premieres semaines, puis s'enrichit au
    // fil des annees : de nouvelles gammes arrivent, ce qui se voit dans les
    // rapports comme un elargissement progressif de l'offre.
    const date = p.arrivee || jour(ajouterJours(new Date(D.DEBUT), Math.floor(index / 6) * 4));
    const photo = copierVersUploads(
      photos.get(`produit-${index}`), 'produits', `produit-${index + 1}`, `produit-${index}`
    );

    const { rows } = await client.query(
      `INSERT INTO produits (nom, prix_vente, unite_stock, unite_achat, facteur_conversion,
                             seuil_alerte, photo, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [p.nom, p.prix, p.unite || 'piece', p.uniteAchat || 'carton', p.facteur || 12,
        p.seuil, photo, `${date}T10:00:00`]
    );
    liste.push({ ...rows[0], config: p, stock: 0 });
    await audit(client, {
      type: 'produit_creation', entiteId: rows[0].id, utilisateurId: adminId, date: `${date}T10:00:00`,
      details: { nom: p.nom },
      apres: {
        nom: p.nom, prix_vente: p.prix, unite_stock: p.unite || 'piece',
        unite_achat: p.uniteAchat || 'carton', facteur_conversion: p.facteur || 12,
      },
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
    details: {
      produit_nom: produit.nom,
      quantite_achat: quantite / (produit.config.facteur || 12),
      cout_achat_total: coutTotal,
    },
    avant: { quantite_stock: stockAvant, cout_moyen_pondere: cmpAvant, unite_stock: produit.unite_stock },
    apres: { quantite_stock: produit.stock, cout_moyen_pondere: produit.cmp, unite_stock: produit.unite_stock },
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
    avant: { quantite_stock: avant, unite_stock: produit.unite_stock },
    apres: { quantite_stock: quantiteCible, unite_stock: produit.unite_stock },
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

    // La quantite depend de l'unite de vente. Un flacon se vend a la piece,
    // mais un parfum en vrac se sert au volume et un encens au poids : vendre
    // "1 mL" d'essence ou "1 g" de bakhour n'aurait aucun sens, et rendrait les
    // quantites des rapports illisibles.
    let quantite;
    if (produit.unite_stock === 'mL') quantite = parmi([10, 15, 20, 25, 30, 50, 50, 100]);
    else if (produit.unite_stock === 'g') quantite = parmi([20, 25, 50, 50, 100, 100, 250]);
    else quantite = chance(0.78) ? 1 : entre(2, 3);

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

/* --- Changement de prix --------------------------------------------------- */

// Un prix qui ne bouge pas pendant deux ans et demi n'existe pas : le change,
// le transport et les couts d'achat le poussent vers le haut. Chaque
// changement est historise, et les ventes deja enregistrees gardent le prix
// applique au moment ou elles ont eu lieu.
async function changerPrix(client, produit, nouveauPrix, horodatage, adminId) {
  const ancien = Number(produit.prix_vente);
  const arrondi = Math.round(nouveauPrix / 500) * 500;
  if (arrondi === ancien) return false;

  await client.query(
    'INSERT INTO historique_prix (produit_id, ancien_prix, nouveau_prix, auteur_id, date) VALUES ($1,$2,$3,$4,$5)',
    [produit.id, ancien, arrondi, adminId, horodatage]
  );
  await client.query(
    'UPDATE produits SET prix_vente = $1, updated_at = $2 WHERE id = $3',
    [arrondi, horodatage, produit.id]
  );
  produit.prix_vente = arrondi;

  await audit(client, {
    type: 'produit_changement_prix', entiteId: produit.id, utilisateurId: adminId, date: horodatage,
    details: { nom: produit.nom, ancien_prix: ancien, nouveau_prix: arrondi },
    avant: { prix_vente: ancien }, apres: { prix_vente: arrondi },
  });
  return true;
}

/* --- Retour client -------------------------------------------------------- */

// Un client rapporte un article : il revient en stock, valorise au cout moyen.
// Sans ce cas, le motif "retour_client" n'apparait jamais et l'ecran des
// mouvements laisse croire qu'un retour est impossible.
async function retourClient(client, produit, quantite, horodatage, adminId) {
  await client.query(
    `INSERT INTO lots_stock (produit_id, quantite_initiale, quantite_restante, cout_unitaire, date_entree)
     VALUES ($1,$2,$2,$3,$4)`,
    [produit.id, quantite, produit.cmp || 0, horodatage]
  );
  const avant = produit.stock;
  produit.stock += quantite;
  await client.query('UPDATE produits SET quantite_stock = $1, updated_at = $2 WHERE id = $3',
    [produit.stock, horodatage, produit.id]);
  await client.query(
    `INSERT INTO mouvements_stock (produit_id, type, quantite, cout_unitaire, auteur_id, motif, note, date)
     VALUES ($1,'entree',$2,$3,$4,'retour_client',$5,$6)`,
    [produit.id, quantite, produit.cmp || 0, adminId,
      parmi([
        'Article rapporte par le client, emballage intact',
        'Erreur de reference a la vente',
        'Le client a change d\'avis, produit non ouvert',
        'Echange contre une autre reference',
      ]), horodatage]
  );
  await audit(client, {
    type: 'ajustement_stock', entiteId: produit.id, utilisateurId: adminId, date: horodatage,
    details: {
      produit_nom: produit.nom, motif: 'retour_client', ecart: quantite,
      valeur_ecart: quantite * (produit.cmp || 0),
    },
    avant: { quantite_stock: avant, unite_stock: produit.unite_stock },
    apres: { quantite_stock: produit.stock, unite_stock: produit.unite_stock },
  });
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
  let nbPrix = 0;
  let nbRetours = 0;
  let moisCourant = -1;

  // Produits retires du catalogue en cours de route, indexes par nom.
  const arrets = new Map(D.PRODUITS_ARRETES.map((a) => [a.nom, a]));

  while (date <= fin) {
    const cle = jour(date);
    const mois = date.getMonth();

    // Nouveau mois : depenses recurrentes.
    if (mois !== moisCourant) {
      moisCourant = mois;
      nbDepenses += await depensesDuMois(client, date, adminId);
    }

    // Produits au catalogue a cette date : entres, et pas encore retires.
    const catalogue = produits.filter((p) => {
      if (jour(new Date(p.created_at)) > cle) return false;
      const arret = arrets.get(p.nom);
      return !arret || arret.date > cle;
    });

    // Revision des prix : en janvier surtout, et ponctuellement quand le cout
    // d'achat a derive. Une hausse de 4 a 12 %, arrondie au multiple de 500 -
    // personne n'affiche un parfum a 46 317 F.
    if (date.getDate() === 15 && (mois === 0 || chance(0.25))) {
      for (const produit of catalogue) {
        if (!chance(mois === 0 ? 0.55 : 0.12)) continue;
        const hausse = 1 + 0.04 + alea() * 0.08;
        if (await changerPrix(client, produit, produit.prix_vente * hausse,
          heureOuvrable(date, 8, 3), adminId)) nbPrix += 1;
      }
    }

    // Promotions et destockage : les prix ne montent pas toujours. On solde ce
    // qui dort en rayon, et on casse les prix avant les fetes. Sans cela,
    // l'historique des prix ne raconte qu'une inflation continue, ce qui ne
    // ressemble a aucun commerce.
    if (date.getDate() === 2 && chance(0.3)) {
      // Les articles a faible rotation et bien approvisionnes sont les premiers
      // soldes : c'est exactement le raisonnement d'un gerant devant son stock.
      const dormants = catalogue.filter((p) => p.config.rotation <= 5 && p.stock > p.config.seuil * 2);
      for (const produit of dormants) {
        if (!chance(0.35)) continue;
        const baisse = 1 - (0.08 + alea() * 0.14);
        if (await changerPrix(client, produit, produit.prix_vente * baisse,
          heureOuvrable(date, 8, 2), adminId)) nbPrix += 1;
      }
    }

    // Retrait d'une reference du catalogue.
    for (const [nom, arret] of arrets) {
      if (arret.date !== cle) continue;
      const produit = produits.find((p) => p.nom === nom);
      if (!produit) continue;
      const horodatage = heureOuvrable(date, 16, 2);
      await client.query('UPDATE produits SET actif = false, updated_at = $1 WHERE id = $2',
        [horodatage, produit.id]);
      await audit(client, {
        type: 'produit_desactivation', entiteId: produit.id, utilisateurId: adminId, date: horodatage,
        details: { nom: produit.nom, motif: arret.motif },
        avant: { actif: true }, apres: { actif: false },
      });
    }

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
      // On commande en unites d'achat : deux a six cartons, mais rarement plus
      // d'un ou deux bidons de cinq litres. Le facteur de conversion fait le
      // reste - c'est exactement ce que fait la saisie d'une entree de stock.
      const facteur = produit.config.facteur || 12;
      const unitesAchat = facteur >= 1000 ? entre(1, 2) : (facteur >= 48 ? entre(1, 3) : entre(2, 6));
      const quantite = unitesAchat * facteur;
      // Le prix d'achat derive legerement au fil des mois, comme un vrai
      // approvisionnement soumis au change et au transport.
      const derive = 1 + (alea() - 0.42) * 0.18;
      const coutTotal = Math.round(quantite * produit.config.achat * derive);
      // On ne commande qu'aux fournisseurs avec qui la relation est ouverte a
      // cette date : passer une commande a quelqu'un qu'on ne connait pas
      // encore, ou avec qui on a cesse, se verrait immediatement dans le journal.
      const disponiblesFournisseurs = fournisseurs.filter((f) => {
        if (f.config?.arrivee && f.config.arrivee > cle) return false;
        if (f.config?.fin && f.config.fin.date < cle) return false;
        return true;
      });
      await entree(client, produit, quantite, coutTotal, parmi(disponiblesFournisseurs).id,
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

    // Retour client : environ une fois tous les dix jours.
    if (chance(0.1) && catalogue.length) {
      const produit = parmi(catalogue);
      const quantiteRetour = produit.unite_stock === 'piece'
        ? (chance(0.85) ? 1 : 2)
        : parmi([10, 20, 25, 50]);
      await retourClient(client, produit, quantiteRetour, heureOuvrable(date, 10, 8), adminId);
      nbRetours += 1;
    }

    // Casse, perte, inventaire : environ une fois par semaine.
    if (chance(0.14) && catalogue.length) {
      const produit = parmi(catalogue.filter((p) => p.stock > 3) || catalogue);
      if (produit && produit.stock > 3) {
        // Une casse porte sur un flacon, mais un renversement de vrac se compte
        // en dizaines de millilitres.
        const enVrac = produit.unite_stock !== 'piece';
        const unites = (min, max) => (enVrac ? parmi([15, 25, 40, 60, 100]) : entre(min, max));
        const cas = parmi([
          { motif: 'casse', note: 'Flacon brise lors de la mise en rayon', perte: unites(1, 2) },
          { motif: 'casse', note: 'Carton tombe a la reception', perte: unites(1, 3) },
          { motif: 'perte', note: 'Article perime retire de la vente', perte: unites(1, 1) },
          { motif: 'vol', note: 'Disparition constatee en fin de journee', perte: unites(1, 1) },
          { motif: 'inventaire', note: 'Ecart constate au comptage des rayons', perte: unites(1, 2) },
          { motif: 'correction', note: 'Erreur de saisie sur une entree precedente', perte: unites(1, 2) },
          { motif: 'vol', note: 'Vol a l\'etalage constate sur les images de surveillance', perte: unites(1, 2) },
          { motif: 'casse', note: 'Renverse par un client en rayon', perte: unites(1, 1) },
          { motif: 'perte', note: 'Fuite du bidon en reserve', perte: unites(1, 2) },
        ]);
        // La perte est bornee au stock reellement present : un renversement de
        // vrac chiffre a cent millilitres sur un fond de bidon qui n'en contient
        // que trente rendrait le stock negatif.
        const perte = Math.min(cas.perte, Math.max(0, produit.stock - 1));
        if (perte > 0) {
          await ajustement(client, produit, produit.stock - perte, cas.motif, cas.note,
            heureOuvrable(date, 17, 2), adminId);
          nbAjustements += 1;
        }
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

  log(`Ventes : ${nbVentes} | Entrees : ${nbEntrees} | Ajustements : ${nbAjustements} | `
    + `Retours : ${nbRetours} | Changements de prix : ${nbPrix} | Depenses : ${nbDepenses}`);
  return { nbVentes, nbEntrees, nbAjustements, nbRetours, nbPrix, nbDepenses };
}

/* --- Depenses ------------------------------------------------------------- */

const NOTES_DEPENSE = {
  Loyer: ['Quittance remise au proprietaire', 'Regle en especes, recu n° 4471'],
  Electricite: ['Facture ENEO du mois', 'Releve elevé, climatisation en marche continue'],
  Eau: ['Facture CAMWATER'],
  Transport: ['Course au marche Mokolo pour reassort', 'Livraison client quartier Bastos',
    'Retrait de colis a l\'agence de transport', 'Deplacement chez le fournisseur'],
  'Fournitures de bureau': ['Rames de papier et cartouches', 'Rouleaux pour l\'imprimante de caisse'],
  'Entretien et reparations': ['Reparation de la vitrine refrigeree', 'Peinture de la devanture',
    'Remplacement de deux neons du rayon'],
  Publicite: ['Campagne sur les reseaux sociaux', 'Banderole pour la fete des meres',
    'Distribution de flyers au quartier'],
  'Frais bancaires': ['Commission de tenue de compte'],
  'Emballages et sachets': ['Commande de sachets kraft logotes', 'Papier cadeau pour les fetes'],
  'Internet et telephone': ['Abonnement fibre et forfaits mobiles'],
};

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

      // Une note sur environ une depense sur trois : c'est ce qu'on retrouve
      // dans un vrai journal de caisse, ni systematique ni absent.
      const note = chance(0.34) ? (NOTES_DEPENSE[categorie.nom] ? parmi(NOTES_DEPENSE[categorie.nom]) : null) : null;

      const { rows } = await client.query(
        `INSERT INTO depenses (categorie, montant, note, auteur_id, date)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [categorie.nom, montant, note, adminId, horodatage]
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
        const cle = `doc-${index}-${rang}-${page}`;
        const source = photos.get(cle);
        if (!source) continue;
        const nomFichier = `piece-${document.id}-${page}.jpg`;
        fs.copyFileSync(source, path.join(dossier, nomFichier));
        const taille = fs.statSync(path.join(dossier, nomFichier)).size;
        manifeste[`uploads/documents/${document.id}/${nomFichier}`] = cle;

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

/* --- Vie courante de l'administration ------------------------------------- */

// Les operations qu'un gerant fait quelques fois par an et qui, sans elles,
// laissent des pans entiers du systeme sans aucune trace : un code de vente
// qu'on remplace, une vendeuse suspendue puis reprise, une fonction rebaptisee,
// des reglages ajustes. C'est ce qui distingue un systeme vecu d'une base
// remplie d'un coup.
async function vieAdministrative(client, contexte) {
  const { vendeuses, employes, adminId } = contexte;
  let compte = 0;

  // Un code de vente qui a circule est remplace.
  const aRegenerer = vendeuses.filter((v) => v.employe.config.vendeuse && !v.employe.config.depart).slice(0, 2);
  for (const [i, v] of aRegenerer.entries()) {
    const horodatage = `${['2025-03-11', '2026-01-19'][i]}T11:20:00`;
    let code;
    do {
      code = String(entre(100000, 999999));
      // eslint-disable-next-line no-await-in-loop
    } while ((await client.query('SELECT 1 FROM vendeuses WHERE code = $1', [code])).rows.length);
    await client.query('UPDATE vendeuses SET code = $1 WHERE id = $2', [code, v.id]);
    // L'ancien code n'est volontairement pas journalise : l'ecrire reviendrait
    // a le laisser lisible par la personne a qui on vient de le retirer.
    await audit(client, {
      type: 'vendeuse_code_regenere', entiteId: v.id, utilisateurId: adminId, date: horodatage,
      details: { vendeuse_nom: v.nom },
    });
    compte += 1;
  }

  // Une vendeuse suspendue quelques semaines, puis reprise.
  const suspendue = vendeuses.find((v) => !v.employe.config.depart && v.id !== aRegenerer[0]?.id);
  if (suspendue) {
    for (const etape of [
      { date: '2025-10-06T17:45:00', actif: false, type: 'vendeuse_desactivation' },
      { date: '2025-11-17T08:40:00', actif: true, type: 'vendeuse_activation' },
    ]) {
      await client.query('UPDATE vendeuses SET actif = $1 WHERE id = $2', [etape.actif, suspendue.id]);
      await audit(client, {
        type: etape.type, entiteId: suspendue.id, utilisateurId: adminId, date: etape.date,
        details: { nom: suspendue.nom },
        avant: { actif: !etape.actif }, apres: { actif: etape.actif },
      });
      compte += 1;
    }
  }

  // Fiche produit corrigee : un seuil d'alerte mal calibre, un conditionnement
  // mal saisi. Cela arrive, et le journal doit pouvoir le montrer.
  const { rows: aCorriger } = await client.query(
    'SELECT id, nom, seuil_alerte FROM produits WHERE actif = true ORDER BY id LIMIT 4'
  );
  for (const [i, p] of aCorriger.entries()) {
    const horodatage = `${['2024-08-22', '2025-02-14', '2025-09-30', '2026-03-24'][i]}T14:10:00`;
    const nouveau = Number(p.seuil_alerte) + entre(2, 6);
    await client.query('UPDATE produits SET seuil_alerte = $1, updated_at = $2 WHERE id = $3',
      [nouveau, horodatage, p.id]);
    await audit(client, {
      type: 'produit_modification', entiteId: p.id, utilisateurId: adminId, date: horodatage,
      details: { nom: p.nom },
      avant: { seuil_alerte: p.seuil_alerte }, apres: { seuil_alerte: nouveau },
    });
    compte += 1;
  }

  // Une fonction rebaptisee, une autre retiree des choix proposes. Le libelle
  // fige dans les periodes de carriere ne bouge pas : les bulletins deja edites
  // gardent le titre porte a l'epoque.
  const { rows: fonctionsBase } = await client.query("SELECT id, nom FROM fonctions WHERE nom = 'Caissiere'");
  if (fonctionsBase.length) {
    await client.query("UPDATE fonctions SET nom = 'Caissiere principale', updated_at = $1 WHERE id = $2",
      ['2026-01-08T09:15:00', fonctionsBase[0].id]);
    await audit(client, {
      type: 'fonction_modification', entiteId: fonctionsBase[0].id, utilisateurId: adminId,
      date: '2026-01-08T09:15:00', details: { nom: 'Caissiere principale' },
      avant: { nom: 'Caissiere', actif: true }, apres: { nom: 'Caissiere principale', actif: true },
    });
    compte += 1;
  }
  const { rows: fonctionRetiree } = await client.query("SELECT id, nom FROM fonctions WHERE nom = 'Vigile'");
  if (fonctionRetiree.length) {
    await client.query('UPDATE fonctions SET actif = false, updated_at = $1 WHERE id = $2',
      ['2026-06-15T10:00:00', fonctionRetiree[0].id]);
    await audit(client, {
      type: 'fonction_modification', entiteId: fonctionRetiree[0].id, utilisateurId: adminId,
      date: '2026-06-15T10:00:00', details: { nom: 'Vigile' },
      avant: { nom: 'Vigile', actif: true }, apres: { nom: 'Vigile', actif: false },
    });
    compte += 1;
  }

  // Reglages ajustes en cours de route.
  for (const etape of [
    {
      date: '2024-04-18T15:30:00', type: 'etablissement_modification',
      details: { champs_modifies: 'etablissement_telephone_2, etablissement_site_web' },
      avant: { etablissement_telephone_2: null, etablissement_site_web: null },
      apres: {
        etablissement_telephone_2: D.ETABLISSEMENT.etablissement_telephone_2,
        etablissement_site_web: D.ETABLISSEMENT.etablissement_site_web,
      },
    },
    {
      date: '2024-10-09T11:05:00', type: 'parametres_logo_modifie',
      details: { logo_path: 'uploads/logo/logo-machibel.png' },
    },
    {
      date: '2025-05-21T16:20:00', type: 'parametres_modification',
      details: { champs_modifies: 'methode_valorisation' },
      avant: { methode_valorisation: 'CMP' }, apres: { methode_valorisation: 'FIFO' },
    },
  ]) {
    await audit(client, { ...etape, entiteId: 1, utilisateurId: adminId });
    compte += 1;
  }
  // La bascule vers FIFO est reellement appliquee : le journal ne doit jamais
  // raconter autre chose que ce que la base contient.
  await client.query("UPDATE parametres SET methode_valorisation = 'FIFO' WHERE id = 1");

  log(`Operations d'administration : ${compte}`);
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

/**
 * Pose le jeu de demonstration complet sur la base courante.
 *
 * ATTENTION : par defaut, commence par vider toutes les tables metier.
 * L'appelant est responsable de verifier qu'il n'y a rien a perdre - c'est ce
 * que fait `src/db/amorcage-demo.js` avant de l'appeler au demarrage.
 *
 * @param {object}  [options]
 * @param {boolean} [options.effacer] false pour ajouter a l'existant sans rien
 *                                    detruire
 * @returns {{ manifeste: object, bilan: object, problemes: string[] }}
 */
async function remplir({ effacer = true } = {}) {
  manifeste = {};
  const client = await pool.connect();
  try {
    const { rows: admins } = await client.query(
      "SELECT id FROM utilisateurs WHERE role = 'admin' ORDER BY id LIMIT 1"
    );
    if (!admins.length) throw new Error("Aucun compte administrateur : demarrez le serveur une fois d'abord.");
    const adminId = admins[0].id;

    log('Photos : lecture du lot versionne (telechargement si absent)...');
    const demandes = demandesPhotosDemo();
    const photos = await obtenirLot(demandes, { journal: log });
    log(`Photos disponibles : ${[...photos.values()].filter(Boolean).length} / ${demandes.length}`);

    await client.query('BEGIN');
    await vider(client, effacer);
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
    await arreterFournisseurs(client, fournisseurs, adminId);
    await vieAdministrative(client, { vendeuses, employes, adminId });
    await client.query('COMMIT');

    log('Verification de coherence...');
    const problemes = await verifier(client);
    if (problemes.length) {
      log(`${problemes.length} PROBLEME(S) DETECTE(S) :`);
      problemes.slice(0, 20).forEach((p) => log(`  - ${p}`));
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

    return { manifeste, bilan, problemes };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { remplir };

/* --- Execution en ligne de commande : `npm run seed-demo` ----------------- */

if (require.main === module) {
  remplir()
    .then(({ problemes }) => {
      if (problemes.length) process.exitCode = 1;
      return pool.end();
    })
    .catch(async (err) => {
      console.error('\nEchec du remplissage :', err.message);
      console.error(err.stack);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
