const pool = require('../config/db');
const { computeResume, computePerformanceProduits } = require('../services/rapports.service');
const {
  DocumentRapport,
  nommerFichier,
  libellePeriode,
  formatMontant,
  formatQuantite,
  formatNombre,
  formatPourcentage,
  formatDateCourte,
  formatDateHeure,
  COULEUR,
} = require('../services/pdf.service');

/**
 * Sorties PDF.
 *
 * Chaque ecran qui affiche une liste filtree peut l'imprimer avec exactement le
 * meme filtre : les parametres de requete sont ceux des endpoints JSON
 * correspondants. Un rapport imprime doit dire la meme chose que l'ecran dont
 * il sort, sinon il ne sert a rien.
 */

/* --- Contexte commun ------------------------------------------------------ */

async function contexteDocument(req) {
  const [{ rows: parametresRows }, { rows: auteurRows }] = await Promise.all([
    pool.query('SELECT * FROM parametres WHERE id = 1'),
    pool.query('SELECT prenom, nom, nom_utilisateur FROM utilisateurs WHERE id = $1', [req.user.id]),
  ]);

  const auteur = auteurRows[0];
  const nomAuteur = auteur
    ? [auteur.prenom, auteur.nom].filter(Boolean).join(' ') || auteur.nom_utilisateur
    : '';

  return { etablissement: parametresRows[0] || {}, auteur: nomAuteur };
}

function devise(etablissement) {
  return etablissement.devise || 'FCFA';
}

// Bornes de periode. `to` arrive souvent en date seule (`2026-08-05`) depuis un
// champ `<input type="date">`, ce qui vaut minuit : sans ce recalage, le dernier
// jour choisi est exclu du rapport et les totaux ne collent pas avec l'ecran.
function bornesPeriode(query) {
  const from = query.from || null;
  let to = query.to || null;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    to = `${to}T23:59:59.999`;
  }
  return { from, to };
}

/* --- Synthese ------------------------------------------------------------- */

async function synthese(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const { from, to } = bornesPeriode(req.query);
  const vendeuseId = req.query.vendeuse_id || undefined;
  const d = devise(etablissement);

  const resume = await computeResume({ from, to, vendeuseId });

  const doc = new DocumentRapport({
    etablissement,
    titre: 'Rapport de synthèse',
    sousTitre: "Activité commerciale, coûts et résultat net sur la période",
    periode: libellePeriode(from, req.query.to),
    auteur,
  });

  /* Chiffres cles */
  const cartes = [];
  if (resume.chiffre_affaires) {
    cartes.push({
      libelle: "Chiffre d'affaires",
      valeur: formatMontant(resume.chiffre_affaires.total, d),
      note: `${formatNombre(resume.nombre_ventes)} vente(s)`,
    });
    cartes.push({
      libelle: 'Articles vendus',
      valeur: formatQuantite(resume.quantite_vendue),
      note: resume.nombre_ventes
        ? `Panier moyen ${formatMontant(resume.chiffre_affaires.total / resume.nombre_ventes, d)}`
        : '',
    });
    cartes.push({
      libelle: 'Coût des marchandises',
      valeur: formatMontant(resume.cout_marchandises_vendues, d),
      note: "Valeur d'achat de ce qui est sorti",
    });
  }
  if (resume.depenses_total !== null) {
    cartes.push({ libelle: 'Dépenses', valeur: formatMontant(resume.depenses_total, d) });
  }
  if (resume.bilan_net !== null) {
    cartes.push({
      libelle: 'Résultat net',
      valeur: formatMontant(resume.bilan_net, d),
      note: 'Ventes - coûts - dépenses',
      ton: Number(resume.bilan_net) >= 0 ? 'positif' : 'negatif',
    });
  }
  if (resume.chiffre_affaires && resume.chiffre_affaires.total > 0) {
    const marge = ((resume.chiffre_affaires.total - resume.cout_marchandises_vendues)
      / resume.chiffre_affaires.total) * 100;
    cartes.push({
      libelle: 'Marge brute',
      valeur: `${formatNombre(marge, 1)} %`,
      note: 'Hors dépenses de fonctionnement',
    });
  }
  doc.chiffresCles(cartes);

  /* Repartition du chiffre d'affaires */
  if (resume.chiffre_affaires) {
    doc.titreSection("Origine du chiffre d'affaires");
    const total = resume.chiffre_affaires.total || 1;
    doc.tableau({
      colonnes: [
        { titre: 'Canal de vente', cle: 'canal', largeur: 4 },
        { titre: 'Montant', cle: 'montant', largeur: 2, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true },
        { titre: 'Part', cle: 'part', largeur: 1.2, alignement: 'right', format: (v) => `${formatNombre(v, 1)} %`, uneLigne: true },
      ],
      lignes: [
        { canal: 'Vente directe en boutique', montant: resume.chiffre_affaires.direct, part: (resume.chiffre_affaires.direct / total) * 100 },
        { canal: 'Vente par une vendeuse', montant: resume.chiffre_affaires.vendeuses, part: (resume.chiffre_affaires.vendeuses / total) * 100 },
      ],
      total: { canal: 'TOTAL', montant: resume.chiffre_affaires.total, part: 100 },
    });
  }

  /* Performance par vendeuse */
  if (resume.par_vendeuse && resume.par_vendeuse.length) {
    doc.titreSection('Performance par vendeuse');
    doc.tableau({
      colonnes: [
        { titre: 'Vendeuse', cle: 'nom', largeur: 4, gras: true },
        { titre: 'Ventes', cle: 'nombre_ventes', largeur: 1.2, alignement: 'right', format: formatNombre, uneLigne: true },
        { titre: 'Montant', cle: 'montant', largeur: 2, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true },
        { titre: 'Contribution', cle: 'taux_contribution', largeur: 1.5, alignement: 'right', format: (v) => `${formatNombre(Number(v) * 100, 1)} %`, uneLigne: true },
      ],
      lignes: resume.par_vendeuse,
      total: {
        nom: 'TOTAL VENDEUSES',
        nombre_ventes: resume.par_vendeuse.reduce((s, v) => s + Number(v.nombre_ventes), 0),
        montant: resume.chiffre_affaires.vendeuses,
        taux_contribution: 1,
      },
    });
  }

  /* Produits : meilleures et faibles ventes */
  if (from && to && resume.modules_actifs.ventes) {
    const performance = await computePerformanceProduits({ from, to, limite: 8 });
    if (performance.actif && performance.meilleures_ventes.length) {
      doc.titreSection('Produits les plus vendus');
      doc.tableau({
        colonnes: [
          { titre: 'Produit', cle: 'nom', largeur: 4.5, gras: true },
          { titre: 'Quantité', cle: 'quantite_vendue', largeur: 1.3, alignement: 'right', format: formatQuantite, uneLigne: true },
          { titre: 'Montant', cle: 'montant', largeur: 2, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true },
          {
            titre: 'Tendance',
            cle: 'variation_pourcentage',
            largeur: 1.6,
            alignement: 'right',
            uneLigne: true,
            videPar: 'nouveau',
            format: (v) => formatPourcentage(v),
            couleur: (v) => (Number(v) >= 0 ? COULEUR.positif : COULEUR.negatif),
          },
        ],
        lignes: performance.meilleures_ventes,
      });

      doc.titreSection('Produits dormants');
      doc.paragraphe(
        "Produits actifs les moins sortis sur la période. Un stock immobilisé sur ces "
        + "références est de la trésorerie qui ne travaille pas.",
        { italique: true }
      );
      doc.tableau({
        colonnes: [
          { titre: 'Produit', cle: 'nom', largeur: 4.5, gras: true },
          { titre: 'Quantité vendue', cle: 'quantite_vendue', largeur: 2, alignement: 'right', format: formatQuantite, uneLigne: true, videPar: '0' },
          { titre: 'Montant', cle: 'montant', largeur: 2, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true, videPar: formatMontant(0, d) },
        ],
        lignes: performance.faibles_ventes,
      });
    }
  }

  doc.envoyer(res, nommerFichier('rapport-de-synthese'));
}

/* --- Ventes --------------------------------------------------------------- */

async function ventes(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const { from, to } = bornesPeriode(req.query);
  const d = devise(etablissement);

  const conditions = [];
  const params = [];
  if (from) { params.push(from); conditions.push(`v.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`v.date <= $${params.length}`); }
  if (req.query.vendeuse_id) { params.push(req.query.vendeuse_id); conditions.push(`v.vendeuse_id = $${params.length}`); }
  if (req.query.type) { params.push(req.query.type); conditions.push(`v.type = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Un rapport doit couvrir toute la periode demandee, pas une page de 20
  // lignes. Le plafond protege la memoire du service sur le plan gratuit ; il
  // est signale dans le document quand il mord.
  const PLAFOND = 3000;
  const { rows: lignes } = await pool.query(
    `SELECT v.id, v.date, v.type, v.montant_total, vd.nom AS vendeuse_nom,
            COALESCE(SUM(vl.quantite), 0) AS articles
       FROM ventes v
       LEFT JOIN vendeuses vd ON vd.id = v.vendeuse_id
       LEFT JOIN ventes_lignes vl ON vl.vente_id = v.id
       ${where}
      GROUP BY v.id, vd.nom
      ORDER BY v.date DESC
      LIMIT ${PLAFOND}`,
    params
  );

  const totalMontant = lignes.reduce((s, l) => s + Number(l.montant_total), 0);
  const totalArticles = lignes.reduce((s, l) => s + Number(l.articles), 0);

  const doc = new DocumentRapport({
    etablissement,
    titre: 'Journal des ventes',
    sousTitre: 'Liste détaillée des ventes enregistrées sur la période',
    periode: libellePeriode(from, req.query.to),
    auteur,
  });

  doc.chiffresCles([
    { libelle: 'Ventes', valeur: formatNombre(lignes.length) },
    { libelle: 'Montant encaissé', valeur: formatMontant(totalMontant, d) },
    {
      libelle: 'Panier moyen',
      valeur: formatMontant(lignes.length ? totalMontant / lignes.length : 0, d),
      note: `${formatQuantite(totalArticles)} article(s)`,
    },
  ]);

  if (lignes.length === PLAFOND) {
    doc.paragraphe(
      `Seules les ${PLAFOND} ventes les plus récentes de la période figurent dans ce document. `
      + 'Resserrez les dates pour obtenir un journal exhaustif.',
      { italique: true }
    );
  }

  doc.titreSection('Détail des ventes');
  doc.tableau({
    colonnes: [
      { titre: 'N°', cle: 'id', largeur: 0.7, alignement: 'right', uneLigne: true },
      { titre: 'Date et heure', cle: 'date', largeur: 2, format: formatDateHeure, uneLigne: true },
      { titre: 'Canal', cle: 'type', largeur: 1.3, format: (v) => (v === 'directe' ? 'Boutique' : 'Vendeuse'), uneLigne: true },
      { titre: 'Attribuée à', cle: 'vendeuse_nom', largeur: 2.6, videPar: 'Vente directe' },
      { titre: 'Articles', cle: 'articles', largeur: 1.1, alignement: 'right', format: formatQuantite, uneLigne: true },
      { titre: 'Montant', cle: 'montant_total', largeur: 1.9, alignement: 'right', format: (v) => formatMontant(v, d), gras: true, uneLigne: true },
    ],
    lignes,
    total: { id: '', date: '', type: '', vendeuse_nom: 'TOTAL', articles: totalArticles, montant_total: totalMontant },
    vide: 'Aucune vente enregistrée sur cette période.',
  });

  doc.envoyer(res, nommerFichier('journal-des-ventes'));
}

/* --- Stock ---------------------------------------------------------------- */

async function stock(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const d = devise(etablissement);

  const { rows: produits } = await pool.query(
    `SELECT id, nom, unite_stock, quantite_stock, seuil_alerte, cout_moyen_pondere, prix_vente,
            (quantite_stock <= seuil_alerte) AS en_alerte,
            (quantite_stock * cout_moyen_pondere) AS valeur_stock
       FROM produits WHERE actif = true ORDER BY nom`
  );

  const valeurTotale = produits.reduce((s, p) => s + Number(p.valeur_stock), 0);
  const enAlerte = produits.filter((p) => p.en_alerte);
  const enRupture = produits.filter((p) => Number(p.quantite_stock) <= 0);

  const doc = new DocumentRapport({
    etablissement,
    titre: 'État du stock',
    sousTitre: 'Inventaire valorisé au coût moyen pondéré',
    periode: `arrêté au ${formatDateCourte(new Date())}`,
    auteur,
  });

  doc.chiffresCles([
    { libelle: 'Références actives', valeur: formatNombre(produits.length) },
    { libelle: 'Valeur du stock', valeur: formatMontant(valeurTotale, d), note: "Au coût d'acquisition" },
    {
      libelle: 'Sous le seuil',
      valeur: formatNombre(enAlerte.length),
      note: enRupture.length ? `dont ${enRupture.length} en rupture` : 'Aucune rupture',
      ton: enAlerte.length ? 'negatif' : 'positif',
    },
  ]);

  if (enAlerte.length) {
    doc.titreSection('À réapprovisionner en priorité');
    doc.tableau({
      colonnes: [
        { titre: 'Produit', cle: 'nom', largeur: 4.5, gras: true },
        { titre: 'Restant', cle: 'quantite_stock', largeur: 1.6, alignement: 'right', format: formatQuantite, uneLigne: true, couleur: () => COULEUR.negatif },
        { titre: 'Unité', cle: 'unite_stock', largeur: 1.2, uneLigne: true },
        { titre: "Seuil d'alerte", cle: 'seuil_alerte', largeur: 1.6, alignement: 'right', format: formatQuantite, uneLigne: true },
        { titre: 'Manque', cle: 'manque', largeur: 1.4, alignement: 'right', format: formatQuantite, uneLigne: true },
      ],
      lignes: enAlerte.map((p) => ({
        ...p,
        manque: Math.max(0, Number(p.seuil_alerte) - Number(p.quantite_stock)),
      })),
    });
  }

  doc.titreSection('Inventaire complet');
  doc.tableau({
    colonnes: [
      { titre: 'Produit', cle: 'nom', largeur: 4, gras: true },
      { titre: 'Quantité', cle: 'quantite_stock', largeur: 1.3, alignement: 'right', format: formatQuantite, uneLigne: true },
      { titre: 'Unité', cle: 'unite_stock', largeur: 1, uneLigne: true },
      { titre: 'Coût unitaire', cle: 'cout_moyen_pondere', largeur: 1.7, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true },
      { titre: 'Prix de vente', cle: 'prix_vente', largeur: 1.7, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true },
      { titre: 'Valeur en stock', cle: 'valeur_stock', largeur: 1.9, alignement: 'right', format: (v) => formatMontant(v, d), gras: true, uneLigne: true },
    ],
    lignes: produits,
    total: {
      nom: 'VALEUR TOTALE DU STOCK', quantite_stock: '', unite_stock: '',
      cout_moyen_pondere: '', prix_vente: '', valeur_stock: valeurTotale,
    },
    vide: 'Aucun produit actif en catalogue.',
  });

  doc.envoyer(res, nommerFichier('etat-du-stock'));
}

/* --- Catalogue produits --------------------------------------------------- */

async function produits(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const d = devise(etablissement);
  const inclureArchives = req.query.includeInactifs === 'true';

  const { rows } = await pool.query(
    inclureArchives
      ? 'SELECT * FROM produits ORDER BY nom'
      : 'SELECT * FROM produits WHERE actif = true ORDER BY nom'
  );

  const doc = new DocumentRapport({
    etablissement,
    titre: 'Catalogue des produits',
    sousTitre: inclureArchives ? 'Références actives et archivées' : 'Références actives',
    periode: `arrêté au ${formatDateCourte(new Date())}`,
    auteur,
  });

  doc.tableau({
    colonnes: [
      { titre: 'Produit', cle: 'nom', largeur: 4, gras: true },
      { titre: 'Prix de vente', cle: 'prix_vente', largeur: 1.7, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true },
      { titre: 'Unité', cle: 'unite_stock', largeur: 1, uneLigne: true },
      { titre: "Unité d'achat", cle: 'unite_achat', largeur: 1.3, uneLigne: true, videPar: '-' },
      { titre: 'Conversion', cle: 'facteur_conversion', largeur: 1.2, alignement: 'right', format: formatQuantite, uneLigne: true },
      { titre: 'Stock', cle: 'quantite_stock', largeur: 1.2, alignement: 'right', format: formatQuantite, uneLigne: true },
      { titre: 'Seuil', cle: 'seuil_alerte', largeur: 1, alignement: 'right', format: formatQuantite, uneLigne: true },
      {
        titre: 'État',
        cle: 'actif',
        largeur: 1.1,
        uneLigne: true,
        format: (v) => (v ? 'Actif' : 'Archivé'),
        couleur: (v) => (v ? COULEUR.texte : COULEUR.negatif),
      },
    ],
    lignes: rows,
    vide: 'Aucun produit au catalogue.',
  });

  doc.envoyer(res, nommerFichier('catalogue-produits'));
}

/* --- Depenses ------------------------------------------------------------- */

async function depenses(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const { from, to } = bornesPeriode(req.query);
  const d = devise(etablissement);

  const conditions = [];
  const params = [];
  if (from) { params.push(from); conditions.push(`d.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`d.date <= $${params.length}`); }
  if (req.query.categorie) { params.push(req.query.categorie); conditions.push(`d.categorie = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [{ rows: lignes }, { rows: parCategorie }] = await Promise.all([
    pool.query(
      `SELECT d.id, d.date, d.categorie, d.montant, d.note,
              COALESCE(u.prenom || ' ' || u.nom, u.nom_utilisateur) AS auteur_nom
         FROM depenses d LEFT JOIN utilisateurs u ON u.id = d.auteur_id
         ${where} ORDER BY d.date DESC LIMIT 3000`,
      params
    ),
    pool.query(
      `SELECT d.categorie, COUNT(*)::int AS nombre, COALESCE(SUM(d.montant), 0) AS montant
         FROM depenses d ${where} GROUP BY d.categorie ORDER BY montant DESC`,
      params
    ),
  ]);

  const total = parCategorie.reduce((s, c) => s + Number(c.montant), 0);

  const doc = new DocumentRapport({
    etablissement,
    titre: 'Journal des dépenses',
    sousTitre: 'Dépenses de fonctionnement enregistrées sur la période',
    periode: libellePeriode(from, req.query.to),
    auteur,
  });

  doc.chiffresCles([
    { libelle: 'Total des dépenses', valeur: formatMontant(total, d) },
    { libelle: 'Écritures', valeur: formatNombre(lignes.length) },
    { libelle: 'Catégories', valeur: formatNombre(parCategorie.length) },
  ]);

  if (parCategorie.length) {
    doc.titreSection('Répartition par catégorie');
    doc.tableau({
      colonnes: [
        { titre: 'Catégorie', cle: 'categorie', largeur: 4, gras: true },
        { titre: 'Écritures', cle: 'nombre', largeur: 1.3, alignement: 'right', format: formatNombre, uneLigne: true },
        { titre: 'Montant', cle: 'montant', largeur: 2, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true },
        {
          titre: 'Part',
          cle: 'montant',
          largeur: 1.2,
          alignement: 'right',
          uneLigne: true,
          format: (v) => `${formatNombre(total ? (Number(v) / total) * 100 : 0, 1)} %`,
        },
      ],
      lignes: parCategorie,
      total: { categorie: 'TOTAL', nombre: lignes.length, montant: total },
    });
  }

  doc.titreSection('Détail des écritures');
  doc.tableau({
    colonnes: [
      { titre: 'Date', cle: 'date', largeur: 1.5, format: formatDateCourte, uneLigne: true },
      { titre: 'Catégorie', cle: 'categorie', largeur: 2, uneLigne: true },
      { titre: 'Note', cle: 'note', largeur: 4, videPar: '-' },
      { titre: 'Saisie par', cle: 'auteur_nom', largeur: 2, uneLigne: true, videPar: '-' },
      { titre: 'Montant', cle: 'montant', largeur: 1.8, alignement: 'right', format: (v) => formatMontant(v, d), gras: true, uneLigne: true },
    ],
    lignes,
    total: { date: '', categorie: '', note: 'TOTAL', auteur_nom: '', montant: total },
    vide: 'Aucune dépense enregistrée sur cette période.',
  });

  doc.envoyer(res, nommerFichier('journal-des-depenses'));
}

/* --- Mouvements de stock -------------------------------------------------- */

async function mouvements(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const { from, to } = bornesPeriode(req.query);
  const d = devise(etablissement);

  const conditions = [];
  const params = [];
  if (from) { params.push(from); conditions.push(`m.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`m.date <= $${params.length}`); }
  if (req.query.produit_id) { params.push(req.query.produit_id); conditions.push(`m.produit_id = $${params.length}`); }
  if (req.query.type) { params.push(req.query.type); conditions.push(`m.type = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: paramRows } = await pool.query('SELECT module_fournisseurs FROM parametres WHERE id = 1');
  const fournisseursActif = paramRows[0].module_fournisseurs;

  const { rows } = await pool.query(
    `SELECT m.id, m.date, m.type, m.quantite, m.cout_unitaire, m.vente_id,
            p.nom AS produit_nom, p.unite_stock,
            ${fournisseursActif ? 'f.nom AS fournisseur_nom' : 'NULL AS fournisseur_nom'}
       FROM mouvements_stock m
       JOIN produits p ON p.id = m.produit_id
       LEFT JOIN fournisseurs f ON f.id = m.fournisseur_id
       ${where} ORDER BY m.date DESC LIMIT 3000`,
    params
  );

  const entrees = rows.filter((r) => r.type === 'entree');
  const sorties = rows.filter((r) => r.type === 'sortie');

  const doc = new DocumentRapport({
    etablissement,
    titre: 'Mouvements de stock',
    sousTitre: 'Entrées et sorties, avec leur origine',
    periode: libellePeriode(from, req.query.to),
    auteur,
  });

  doc.chiffresCles([
    { libelle: 'Mouvements', valeur: formatNombre(rows.length) },
    { libelle: 'Entrées', valeur: formatNombre(entrees.length), note: `${formatQuantite(entrees.reduce((s, r) => s + Number(r.quantite), 0))} unité(s)` },
    { libelle: 'Sorties', valeur: formatNombre(sorties.length), note: `${formatQuantite(sorties.reduce((s, r) => s + Number(r.quantite), 0))} unité(s)` },
  ]);

  doc.tableau({
    colonnes: [
      { titre: 'Date', cle: 'date', largeur: 1.8, format: formatDateHeure, uneLigne: true },
      { titre: 'Produit', cle: 'produit_nom', largeur: 3.4, gras: true },
      {
        titre: 'Sens',
        cle: 'type',
        largeur: 1,
        uneLigne: true,
        format: (v) => (v === 'entree' ? 'Entrée' : 'Sortie'),
        couleur: (v) => (v === 'entree' ? COULEUR.positif : COULEUR.negatif),
      },
      { titre: 'Quantité', cle: 'quantite', largeur: 1.3, alignement: 'right', format: formatQuantite, uneLigne: true },
      { titre: 'Unité', cle: 'unite_stock', largeur: 1, uneLigne: true },
      { titre: 'Coût unitaire', cle: 'cout_unitaire', largeur: 1.7, alignement: 'right', format: (v) => formatMontant(v, d), uneLigne: true, videPar: '-' },
      {
        titre: 'Origine',
        cle: 'origine',
        largeur: 2.2,
        uneLigne: true,
        format: (v, ligne) => ligne.fournisseur_nom || (ligne.vente_id ? `Vente n°${ligne.vente_id}` : '-'),
      },
    ],
    // `origine` est calculee a l'affichage : sans cle presente, la cellule serait
    // consideree vide et le format ne serait jamais appele.
    lignes: rows.map((r) => ({ ...r, origine: r.fournisseur_nom || r.vente_id || '-' })),
    vide: 'Aucun mouvement sur cette période.',
  });

  doc.envoyer(res, nommerFichier('mouvements-de-stock'));
}

/* --- Journal d'audit ------------------------------------------------------ */

async function historique(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const { from, to } = bornesPeriode(req.query);

  const conditions = [];
  const params = [];
  if (from) { params.push(from); conditions.push(`h.date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`h.date <= $${params.length}`); }
  if (req.query.type_operation) { params.push(req.query.type_operation); conditions.push(`h.type_operation = $${params.length}`); }
  if (req.query.utilisateur_id) { params.push(req.query.utilisateur_id); conditions.push(`h.utilisateur_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT h.id, h.date, h.type_operation, h.entite_id, h.details,
            COALESCE(NULLIF(TRIM(COALESCE(u.prenom, '') || ' ' || COALESCE(u.nom, '')), ''), u.nom_utilisateur) AS utilisateur_nom
       FROM historique_audit h LEFT JOIN utilisateurs u ON u.id = h.utilisateur_id
       ${where} ORDER BY h.date DESC LIMIT 2000`,
    params
  );

  const doc = new DocumentRapport({
    etablissement,
    titre: "Journal d'audit",
    sousTitre: 'Trace horodatée des opérations sensibles',
    periode: libellePeriode(from, req.query.to),
    auteur,
  });

  doc.paragraphe(
    "Ce journal est produit à partir de traces non modifiables. Il indique qui a fait quoi et "
    + "à quel moment ; le détail complet de chaque opération reste consultable dans l'application.",
    { italique: true }
  );

  doc.tableau({
    colonnes: [
      { titre: 'Date et heure', cle: 'date', largeur: 1.9, format: formatDateHeure, uneLigne: true },
      { titre: 'Opération', cle: 'type_operation', largeur: 3, format: (v) => LIBELLES_AUDIT[v] || String(v).replace(/_/g, ' '), gras: true },
      { titre: 'Référence', cle: 'entite_id', largeur: 1, alignement: 'right', uneLigne: true, videPar: '-' },
      { titre: 'Auteur', cle: 'utilisateur_nom', largeur: 2.2, uneLigne: true, videPar: 'Système' },
      { titre: 'Résumé', cle: 'resume', largeur: 3.5 },
    ],
    lignes: rows.map((r) => ({ ...r, resume: resumerDetails(r.details) })),
    vide: 'Aucune opération sur cette période.',
  });

  doc.envoyer(res, nommerFichier('journal-audit'));
}

// Libelles lisibles des operations. Doublon assume avec la table du frontend :
// le PDF est produit cote serveur et ne peut pas lire un fichier Vue.
const LIBELLES_AUDIT = {
  produit_creation: 'Produit créé',
  produit_modification: 'Produit modifié',
  produit_changement_prix: 'Prix de vente changé',
  produit_desactivation: 'Produit archivé',
  vendeuse_creation: 'Vendeuse créée',
  vendeuse_activation: 'Vendeuse réactivée',
  vendeuse_desactivation: 'Vendeuse désactivée',
  utilisateur_creation: 'Compte créé',
  utilisateur_desactivation: 'Compte bloqué',
  utilisateur_reactivation: 'Compte débloqué',
  utilisateur_changement_mot_de_passe: 'Mot de passe changé',
  admin_initial_cree: 'Compte administrateur initial',
  vente_creation: 'Vente enregistrée',
  entree_stock: 'Entrée de stock',
  depense_creation: 'Dépense enregistrée',
  fournisseur_creation: 'Fournisseur créé',
  fournisseur_activation: 'Fournisseur réactivé',
  fournisseur_desactivation: 'Fournisseur désactivé',
  parametres_modification: 'Paramètres modifiés',
  parametres_logo_modifie: 'Logo modifié',
  etablissement_modification: "Identité de l'établissement modifiée",
};

// Resume d'une ligne d'audit en une phrase courte. Tolere les deux formes de
// `details` : l'objet plat des premieres versions et la forme { resume, avant,
// apres } introduite ensuite.
function resumerDetails(details) {
  if (!details || typeof details !== 'object') return '';
  const source = details.resume && typeof details.resume === 'object'
    ? details.resume
    : details;

  const morceaux = [];
  for (const [cle, valeur] of Object.entries(source)) {
    if (valeur === null || valeur === undefined || typeof valeur === 'object') continue;
    if (/password|hash|secret|token/i.test(cle)) continue;
    morceaux.push(`${cle.replace(/_/g, ' ')} : ${valeur}`);
    if (morceaux.length === 3) break;
  }
  return morceaux.join(' - ');
}

module.exports = { synthese, ventes, stock, produits, depenses, mouvements, historique };
