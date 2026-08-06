const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { jetonRecu, qrEnPng } = require('./verification.service');
const { versionReduite, TAILLES } = require('./images.service');
const {
  nettoyer, formatMontant, formatDateCourte, formatDateLongue,
} = require('./pdf.service');

// -----------------------------------------------------------------------------
// Recu de paie, en double exemplaire sur une seule feuille.
//
// La feuille est en A4 PAYSAGE et porte deux recus identiques cote a cote. On
// coupe verticalement au milieu : l'employe signe les deux, emporte le sien, et
// l'etablissement conserve l'autre comme souche. C'est la forme classique du
// couple "volet + souche", et le pli vertical se coupe mieux a la main qu'un pli
// horizontal.
//
// Chaque exemplaire porte le meme numero de recu et le meme QR : c'est ce qui
// permet, des annees apres, de rapprocher la souche du volet presente.
// -----------------------------------------------------------------------------

const PAGE = { largeur: 841.89, hauteur: 595.28 }; // A4 paysage
const MOITIE = PAGE.largeur / 2;
const MARGE = 26;

const TAILLE = {
  etablissement: 11,
  titre: 10.5,
  corps: 8,
  petit: 7,
  minuscule: 6,
  montant: 15,
};

const COULEUR = {
  texte: '#111827',
  doux: '#4b5563',
  tresDoux: '#8b95a5',
  filet: '#d1d5db',
  fond: '#f3f4f6',
  accent: '#1b5fd0',
  positif: '#15803d',
  negatif: '#b91c1c',
};

const FORMATS_IMPRIMABLES = ['.png', '.jpg', '.jpeg'];

// Le logo passe par sa version reduite : embarque tel quel, celui livre par
// defaut pese 1,4 Mo pour une vignette de 12 millimetres, et il est repete deux
// fois sur la feuille.
function logoPrepare(relatif) {
  if (!relatif) return null;
  if (!FORMATS_IMPRIMABLES.includes(path.extname(relatif).toLowerCase())) return null;
  const racine = path.join(__dirname, '..', '..');
  const complet = path.resolve(racine, relatif.replace(/^\/+/, ''));
  if (!complet.startsWith(racine) || !fs.existsSync(complet)) return null;
  try {
    return versionReduite(relatif, TAILLES.impression) || complet;
  } catch {
    return complet;
  }
}

function deuxChiffres(n) { return String(n).padStart(2, '0'); }

function heure(valeur) {
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(d.getTime())) return '-';
  return `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
}

/**
 * Dessine un exemplaire complet dans la moitie commencant a `x0`.
 *
 * `mention` distingue le volet remis de la souche conservee : les deux sont
 * identiques au mot pres, sinon on ne saurait plus lequel donner.
 */
function dessinerExemplaire(doc, x0, donnees) {
  const {
    etablissement, versement, ligne, cycle, qr, logo, mention, devise, editeLe,
  } = donnees;

  const largeur = MOITIE - MARGE * 2;
  const x = x0 + MARGE;
  let y = MARGE;

  /* --- Entete etablissement --- */
  let xTexte = x;
  if (logo) {
    try {
      doc.image(logo, x, y, { fit: [34, 34] });
      xTexte = x + 40;
    } catch { /* entete sans logo */ }
  }

  doc.font('Helvetica-Bold').fontSize(TAILLE.etablissement).fillColor(COULEUR.texte)
    .text(nettoyer(etablissement.etablissement_nom || 'MACHIBEL'), xTexte, y,
      { width: largeur - (xTexte - x), lineBreak: false, ellipsis: true });

  const lieu = [etablissement.etablissement_adresse, etablissement.etablissement_quartier,
    etablissement.etablissement_ville].filter(Boolean).map(nettoyer).join(', ');
  const contact = [
    etablissement.etablissement_telephone,
    etablissement.etablissement_email,
  ].filter(Boolean).map(nettoyer).join('  -  ');

  doc.font('Helvetica').fontSize(TAILLE.minuscule).fillColor(COULEUR.doux);
  let yLigne = y + 13;
  for (const texte of [lieu, contact]) {
    if (!texte) continue;
    doc.text(texte, xTexte, yLigne, { width: largeur - (xTexte - x), lineBreak: false, ellipsis: true });
    yLigne += 7.5;
  }

  y = Math.max(yLigne, y + 36) + 4;
  doc.save().moveTo(x, y).lineTo(x + largeur, y).lineWidth(0.8).strokeColor(COULEUR.accent).stroke().restore();
  y += 10;

  /* --- Titre et numero --- */
  doc.font('Helvetica-Bold').fontSize(TAILLE.titre).fillColor(COULEUR.texte)
    .text('REÇU DE PAIEMENT DE SALAIRE', x, y, { width: largeur * 0.62, characterSpacing: 0.3 });

  doc.font('Helvetica').fontSize(TAILLE.minuscule).fillColor(COULEUR.tresDoux)
    .text(nettoyer(mention), x, y + 13, { width: largeur * 0.62, characterSpacing: 0.5 });

  // Le numero est le seul moyen de retrouver un paiement : il doit se lire de
  // loin, sans hesitation possible entre deux caracteres.
  doc.font('Courier-Bold').fontSize(12).fillColor(COULEUR.accent)
    .text(versement.numero_recu, x + largeur * 0.62, y - 1,
      { width: largeur * 0.38, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(TAILLE.minuscule).fillColor(COULEUR.tresDoux)
    .text(`Cycle ${cycle.reference}`, x + largeur * 0.62, y + 14,
      { width: largeur * 0.38, align: 'right', lineBreak: false });

  y += 30;

  /* --- Identite de l'employe --- */
  const hauteurBloc = 46;
  doc.save().rect(x, y, largeur, hauteurBloc).fillColor(COULEUR.fond).fill().restore();

  const colonne = largeur / 3;
  const champs = [
    ['EMPLOYE', ligne.nom_complet_snapshot],
    ['MATRICULE', ligne.matricule_snapshot],
    ['FONCTION', ligne.fonction_snapshot || '-'],
    ['PERIODE', `${formatDateCourte(cycle.periode_debut)} au ${formatDateCourte(cycle.periode_fin)}`],
    ['DATE DU PAIEMENT', `${formatDateCourte(versement.paye_le)} a ${heure(versement.paye_le)}`],
    ['MODE DE REGLEMENT', versement.mode_paiement || 'Especes'],
  ];

  champs.forEach((champ, index) => {
    const col = index % 3;
    const rang = Math.floor(index / 3);
    const cx = x + col * colonne + 7;
    const cy = y + 6 + rang * 21;
    doc.font('Helvetica').fontSize(TAILLE.minuscule).fillColor(COULEUR.tresDoux)
      .text(champ[0], cx, cy, { width: colonne - 12, characterSpacing: 0.4, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(TAILLE.corps).fillColor(COULEUR.texte)
      .text(nettoyer(champ[1]), cx, cy + 8, { width: colonne - 12, lineBreak: false, ellipsis: true });
  });

  y += hauteurBloc + 12;

  /* --- Decomposition --- */
  // Chaque ajustement est nomme et signe. Une retenue qu'on decouvre sans
  // explication sur son bulletin est la premiere source de litige.
  const lignesDetail = [
    { libelle: 'Salaire de base', montant: Number(ligne.salaire_base), gras: false },
  ];

  const general = Number(ligne.ajustement_general);
  if (general !== 0) {
    const sens = general > 0 ? 'Augmentation generale' : 'Retenue generale';
    lignesDetail.push({
      libelle: cycle.ajustement_motif ? `${sens} - ${cycle.ajustement_motif}` : sens,
      montant: general,
      teinte: true,
    });
  }

  const particulier = Number(ligne.ajustement_particulier);
  if (particulier !== 0) {
    const sens = particulier > 0 ? 'Augmentation particuliere' : 'Retenue particuliere';
    lignesDetail.push({
      libelle: ligne.ajustement_motif ? `${sens} - ${ligne.ajustement_motif}` : sens,
      montant: particulier,
      teinte: true,
    });
  }

  doc.font('Helvetica-Bold').fontSize(TAILLE.minuscule).fillColor(COULEUR.tresDoux)
    .text('DETAIL DE LA REMUNERATION', x, y, { characterSpacing: 0.5 });
  y += 11;

  for (const detail of lignesDetail) {
    doc.font('Helvetica').fontSize(TAILLE.corps)
      .fillColor(detail.teinte ? (detail.montant > 0 ? COULEUR.positif : COULEUR.negatif) : COULEUR.doux)
      .text(nettoyer(detail.libelle), x, y, { width: largeur * 0.66, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(TAILLE.corps)
      .text(`${detail.montant > 0 && detail.teinte ? '+' : ''}${formatMontant(detail.montant, devise)}`,
        x + largeur * 0.66, y, { width: largeur * 0.34, align: 'right', lineBreak: false });
    y += 12;
  }

  y += 2;
  doc.save().moveTo(x, y).lineTo(x + largeur, y).lineWidth(0.5).strokeColor(COULEUR.filet).stroke().restore();
  y += 6;

  const rappels = [
    ['Net a payer pour la periode', Number(ligne.net_a_payer)],
    ['Deja verse avant ce paiement', Number(ligne.montant_paye) - Number(versement.montant)],
  ];
  for (const [libelle, montant] of rappels) {
    doc.font('Helvetica').fontSize(TAILLE.petit).fillColor(COULEUR.doux)
      .text(libelle, x, y, { width: largeur * 0.66, lineBreak: false });
    doc.font('Helvetica').fontSize(TAILLE.petit).fillColor(COULEUR.doux)
      .text(formatMontant(montant, devise), x + largeur * 0.66, y,
        { width: largeur * 0.34, align: 'right', lineBreak: false });
    y += 11;
  }

  y += 4;

  /* --- Montant verse : l'information centrale --- */
  const hauteurMontant = 40;
  doc.save().rect(x, y, largeur, hauteurMontant).fillColor(COULEUR.accent).fill().restore();
  doc.font('Helvetica').fontSize(TAILLE.minuscule).fillColor('#c9dcfa')
    .text(versement.est_solde ? 'MONTANT VERSE - SOLDE DE LA PERIODE' : 'MONTANT VERSE - ACOMPTE',
      x + 10, y + 7, { characterSpacing: 0.5, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(TAILLE.montant).fillColor('#ffffff')
    .text(formatMontant(versement.montant, devise), x + 10, y + 17,
      { width: largeur - 20, lineBreak: false });

  const restant = Number(ligne.net_a_payer) - Number(ligne.montant_paye);
  if (restant > 0.005) {
    doc.font('Helvetica-Bold').fontSize(TAILLE.petit).fillColor('#ffe0e0')
      .text(`Reste du : ${formatMontant(restant, devise)}`, x + largeur * 0.5, y + 21,
        { width: largeur * 0.5 - 10, align: 'right', lineBreak: false });
  }

  y += hauteurMontant + 14;

  /* --- Parcours des versements de la periode --- */
  // Un employe paye en trois fois veut voir les trois lignes, pas seulement
  // celle du jour. C'est aussi ce qui evite la contestation : le decompte est
  // sous ses yeux, et le versement de ce recu-ci est marque.
  const listeVersements = donnees.versements || [];
  if (listeVersements.length > 1) {
    doc.font('Helvetica-Bold').fontSize(TAILLE.minuscule).fillColor(COULEUR.tresDoux)
      .text('VERSEMENTS DE LA PERIODE', x, y, { characterSpacing: 0.5 });
    y += 11;

    for (const v of listeVersements) {
      const courant = v.numero_recu === versement.numero_recu;
      if (courant) {
        doc.save().rect(x - 3, y - 2, largeur + 6, 12).fillColor('#eef4fe').fill().restore();
      }
      doc.font(courant ? 'Helvetica-Bold' : 'Helvetica').fontSize(TAILLE.petit)
        .fillColor(courant ? COULEUR.accent : COULEUR.doux);

      doc.text(
        `${formatDateCourte(v.paye_le)} a ${heure(v.paye_le)}   ${v.numero_recu}`
        + `${v.est_solde ? '   (solde)' : '   (acompte)'}${courant ? '   <- ce recu' : ''}`,
        x, y, { width: largeur * 0.68, lineBreak: false, ellipsis: true }
      );
      doc.text(formatMontant(v.montant, devise), x + largeur * 0.68, y,
        { width: largeur * 0.32, align: 'right', lineBreak: false });
      y += 12;
    }
    y += 6;
  }

  /* --- Signatures et QR --- */
  const largeurQr = 58;
  const yBas = PAGE.hauteur - MARGE - 62;

  const largeurSignature = (largeur - largeurQr - 14) / 2;
  ['Signature de l\'employe', 'Cachet et signature'].forEach((titre, index) => {
    const sx = x + index * (largeurSignature + 8);
    doc.font('Helvetica').fontSize(TAILLE.minuscule).fillColor(COULEUR.tresDoux)
      .text(nettoyer(titre), sx, yBas, { width: largeurSignature, lineBreak: false });
    doc.save().roundedRect(sx, yBas + 10, largeurSignature, 42, 3)
      .lineWidth(0.5).strokeColor(COULEUR.filet).dash(2, { space: 2 }).stroke().restore();
  });

  if (qr) {
    try {
      doc.image(qr, x + largeur - largeurQr, yBas, { fit: [largeurQr, largeurQr] });
    } catch { /* recu lisible sans QR */ }
  }

  /* --- Pied --- */
  const yPied = PAGE.hauteur - MARGE + 4;
  doc.save().moveTo(x, yPied - 8).lineTo(x + largeur, yPied - 8)
    .lineWidth(0.4).strokeColor(COULEUR.filet).stroke().restore();

  // Les deux horodatages sont distincts et doivent le rester : l'heure du
  // paiement atteste du versement, celle de l'edition dit quand ce papier-ci a
  // ete imprime. Un recu reimprime six mois plus tard porte donc deux dates
  // differentes, et c'est voulu.
  doc.font('Helvetica').fontSize(TAILLE.minuscule - 0.5).fillColor(COULEUR.tresDoux)
    .text(
      `Paye le ${formatDateLongue(versement.paye_le)} a ${heure(versement.paye_le)}   |   `
      + `Edite le ${formatDateCourte(editeLe)} a ${heure(editeLe)}`,
      x, yPied - 4, { width: largeur * 0.72, lineBreak: false }
    );
  doc.font('Helvetica').fontSize(TAILLE.minuscule - 0.5).fillColor(COULEUR.tresDoux)
    .text(nettoyer(etablissement.etablissement_mention_pied || 'Document authentifiable par scan'),
      x + largeur * 0.72, yPied - 4, { width: largeur * 0.28, align: 'right', lineBreak: false });
}

/** Ligne de coupe verticale au milieu de la feuille. */
function ligneDeCoupe(doc) {
  doc.save()
    .moveTo(MOITIE, 10).lineTo(MOITIE, PAGE.hauteur - 10)
    .lineWidth(0.5).strokeColor('#b8bfc9').dash(4, { space: 4 }).stroke()
    .restore();

  doc.save().font('Helvetica').fontSize(5.5).fillColor('#b8bfc9');
  // Repere de decoupe, ecrit verticalement pour ne pas empieter sur les recus.
  doc.rotate(-90, { origin: [MOITIE, PAGE.hauteur / 2] })
    .text('- - - decouper suivant ce trait - - -', MOITIE - 60, PAGE.hauteur / 2 - 8,
      { width: 120, align: 'center', lineBreak: false });
  doc.restore();
}

/**
 * Construit le PDF d'un recu, en double exemplaire sur une feuille A4 paysage.
 */
async function creerRecu({ etablissement, versement, ligne, cycle, versements = [] }) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    bufferPages: true,
    info: {
      Title: nettoyer(`Recu de paie ${versement.numero_recu}`),
      Author: nettoyer(etablissement.etablissement_nom || 'MACHIBEL'),
      Creator: 'MACHIBEL - Gestion de parfumerie',
      CreationDate: new Date(),
    },
  });

  const qr = await qrEnPng(jetonRecu(versement.numero_recu), { taille: 220 }).catch(() => null);
  const logo = logoPrepare(etablissement.logo_path);
  const devise = etablissement.devise || 'FCFA';
  const editeLe = new Date();

  const commun = { etablissement, versement, ligne, cycle, qr, logo, devise, editeLe, versements };

  dessinerExemplaire(doc, 0, { ...commun, mention: 'EXEMPLAIRE REMIS A L\'EMPLOYE' });
  dessinerExemplaire(doc, MOITIE, { ...commun, mention: 'SOUCHE CONSERVEE PAR L\'ETABLISSEMENT' });
  ligneDeCoupe(doc);

  return doc;
}

module.exports = { creerRecu };
