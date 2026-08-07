const pool = require('../config/db');
const {
  DocumentRapport, nommerFichier,
  formatMontant, formatQuantite, formatDateHeure,
} = require('../services/pdf.service');
const { qrEnPng, jetonFacture } = require('../services/verification.service');

// -----------------------------------------------------------------------------
// Facture de vente.
//
// Sous-option du module Ventes : une facture n'a de sens que la ou il y a des
// ventes. Quand elle est active, chaque vente recoit son numero au moment ou
// elle est enregistree - jamais recalcule ensuite, de sorte qu'une facture
// reimprimee six mois plus tard porte exactement le meme.
//
// Le document reste imprimable sur une facture deja emise meme si la
// sous-option est desactivee depuis : ce qui a ete facture doit pouvoir etre
// reedite, sinon un client qui reclame son duplicata reste sans reponse.
// -----------------------------------------------------------------------------

async function contexte(req) {
  const [{ rows: parametres }, { rows: auteurs }] = await Promise.all([
    pool.query('SELECT * FROM parametres WHERE id = 1'),
    pool.query('SELECT prenom, nom, nom_utilisateur FROM utilisateurs WHERE id = $1', [req.user.id]),
  ]);
  const a = auteurs[0];
  return {
    etablissement: parametres[0] || {},
    auteur: a ? [a.prenom, a.nom].filter(Boolean).join(' ') || a.nom_utilisateur : '',
  };
}

const devise = (e) => e.devise || 'FCFA';

async function facture(req, res) {
  const { etablissement, auteur } = await contexte(req);
  const d = devise(etablissement);

  const { rows: ventes } = await pool.query(
    `SELECT v.*, vd.nom AS vendeuse_nom, u.prenom AS auteur_prenom, u.nom AS auteur_nom
       FROM ventes v
       LEFT JOIN vendeuses vd ON vd.id = v.vendeuse_id
       LEFT JOIN utilisateurs u ON u.id = v.auteur_id
      WHERE v.id = $1`,
    [req.params.id]
  );
  const vente = ventes[0];
  if (!vente) return res.status(404).json({ message: 'Vente introuvable' });

  if (!vente.numero_facture) {
    // Numeroter apres coup donnerait a une vente ancienne un numero de la serie
    // courante, intercale au milieu de factures posterieures. La numerotation
    // n'a de valeur que si elle suit l'ordre des ventes.
    return res.status(409).json({
      message: "Cette vente n'a pas de facture : elle a ete enregistree alors que la "
        + 'facturation etait desactivee. Activez-la dans Parametres pour que les ventes '
        + 'suivantes en recoivent une.',
      code: 'SANS_FACTURE',
    });
  }

  const { rows: lignes } = await pool.query(
    `SELECT l.*, p.nom AS produit_nom, p.unite_stock,
            c.nom AS categorie, m.nom AS marque
       FROM ventes_lignes l
       JOIN produits p ON p.id = l.produit_id
       LEFT JOIN categories c ON c.id = p.categorie_id
       LEFT JOIN marques m ON m.id = p.marque_id
      WHERE l.vente_id = $1
      ORDER BY l.id`,
    [req.params.id]
  );

  const doc = new DocumentRapport({
    etablissement,
    titre: 'Facture',
    sousTitre: `N° ${vente.numero_facture}`,
    auteur,
    sansPeriode: true,
  });

  const vendeur = vente.type === 'vendeuse' && vente.vendeuse_nom
    ? vente.vendeuse_nom
    : [vente.auteur_prenom, vente.auteur_nom].filter(Boolean).join(' ') || 'Boutique';

  doc.chiffresCles([
    { libelle: 'Numero', valeur: vente.numero_facture },
    { libelle: 'Date', valeur: formatDateHeure(vente.date) },
    { libelle: 'Total', valeur: formatMontant(vente.montant_total, d) },
  ]);

  doc.titreSection('Detail');
  doc.tableau({
    colonnes: [
      { titre: 'Article', cle: 'produit_nom', largeur: 3.4 },
      {
        titre: 'Marque / rayon',
        cle: 'classement',
        largeur: 1.9,
        // Colonne calculee : elle n'existe pas dans la requete, elle se deduit
        // de deux colonnes jointes.
        calcule: (l) => [l.marque, l.categorie].filter(Boolean).join(' · '),
      },
      {
        titre: 'Quantite',
        cle: 'quantite',
        largeur: 1.3,
        alignement: 'right',
        uneLigne: true,
        format: (v, l) => `${formatQuantite(v)} ${l.unite_stock || ''}`.trim(),
      },
      {
        titre: 'Prix unitaire',
        cle: 'prix_vente_snapshot',
        largeur: 1.6,
        alignement: 'right',
        uneLigne: true,
        format: (v) => formatMontant(v, d),
      },
      {
        titre: 'Montant',
        cle: 'montant',
        largeur: 1.7,
        alignement: 'right',
        gras: true,
        uneLigne: true,
        // Le montant de ligne n'est pas stocke : il se recalcule a partir du
        // prix FIGE au moment de la vente, jamais du prix courant du catalogue.
        calcule: (l) => formatMontant(Number(l.quantite) * Number(l.prix_vente_snapshot), d),
      },
    ],
    lignes,
    total: {
      produit_nom: `TOTAL — ${lignes.length} article(s)`,
      classement: '', quantite: '', prix_vente_snapshot: '',
      montant: formatMontant(vente.montant_total, d),
    },
    vide: 'Aucune ligne sur cette vente.',
  });

  doc.paragraphe(
    `Vente ${vente.type === 'vendeuse' ? 'attribuee a' : 'encaissee par'} ${vendeur}. `
    + 'Les prix portes sur cette facture sont ceux appliques au moment de la vente ; '
    + 'un changement de tarif posterieur ne les modifie pas.'
  );

  // Meme dispositif que les badges et les recus de paie : le code porte une
  // signature, et l'ecran Parametres > Verification dit si le document est
  // authentique. Sans lui, une facture se refait sous Word en cinq minutes.
  try {
    const png = await qrEnPng(jetonFacture(vente.numero_facture), { taille: 240 });
    doc.blocVerification(png, `Facture ${vente.numero_facture}`);
  } catch {
    // Un QR absent ne doit pas empecher la facture de sortir.
  }

  doc.envoyer(res, nommerFichier(`facture-${vente.numero_facture}`));
}

module.exports = { facture };
