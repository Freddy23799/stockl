const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { jetonBadge, qrEnPng } = require('./verification.service');
const { nettoyer, formatDateCourte } = require('./pdf.service');
const { versionReduite, TAILLES } = require('./images.service');

// -----------------------------------------------------------------------------
// Badge employe.
//
// Format CR80 (ISO/IEC 7810 ID-1) : 85,6 x 54 mm, celui d'une carte bancaire.
// C'est la taille qu'acceptent les porte-badges, les cordons et les imprimantes
// a cartes du commerce - en inventer une autre obligerait a tout faire fabriquer
// sur mesure.
//
// Orientation portrait : un badge paysage suspendu a un cordon se retourne et
// se lit a l'envers la moitie du temps. Les badges d'entreprise sont portrait
// pour cette seule raison.
//
// Composition, de haut en bas : bandeau d'identite de l'etablissement, photo,
// nom, fonction, puis une bande basse portant le matricule et le QR de
// verification. L'ordre suit celui du regard : on cherche d'abord le visage,
// puis le nom.
// -----------------------------------------------------------------------------

const MM = 72 / 25.4;

const BADGE = {
  largeur: 54 * MM,   // 153,07 pt
  hauteur: 85.6 * MM, // 242,65 pt
};

const PAGE = { largeur: 595.28, hauteur: 841.89 };

// Neuf badges par feuille A4 : trois colonnes de 54 mm et trois rangees de
// 85,6 mm tiennent dans les marges d'une imprimante de bureau.
const GRILLE = { colonnes: 3, rangees: 3, ecart: 8 };

const COULEUR = {
  bandeau: '#1b5fd0',
  // Deux tons de bleu : un filet plus clair sous le bandeau donne au badge une
  // assise, la ou un aplat unique se lit comme un rectangle colle en haut.
  bandeauClair: '#4a86e8',
  bandeauTexte: '#ffffff',
  bandeauTexteDoux: '#dbe6fb',
  texte: '#111827',
  doux: '#4b5563',
  tresDoux: '#9ca3af',
  bord: '#d1d5db',
  fondPhoto: '#eef2f7',
  fondPied: '#f3f6fb',
  decoupe: '#c7ccd4',
};

/**
 * Coordonnees de l'etablissement, sur une ligne.
 *
 * Un badge perdu doit pouvoir etre rapporte : sans un numero a appeler, la
 * personne qui le ramasse n'a aucun moyen de savoir a qui le rendre.
 *
 * UN seul numero et la ville, pas davantage : sur 54 mm de large, deux numeros
 * plus le quartier ne tiennent pas, et celui qui rapporte une carte n'appelle
 * de toute facon que le premier.
 */
function contactEtablissement(e) {
  const telephone = e.etablissement_telephone || e.etablissement_telephone_2;
  const lieu = e.etablissement_ville || e.etablissement_quartier;
  return [telephone && `Tel. ${telephone}`, lieu].filter(Boolean).join(' - ');
}

/**
 * Tronque un texte pour qu'il tienne sur UNE ligne de la largeur donnee.
 *
 * `lineBreak: false` et `ellipsis: true` ne suffisent pas : le texte passe
 * quand meme a la ligne et vient recouvrir ce qui suit. Sur une carte de 54 mm,
 * le secteur d'activite recouvrait « CARTE PROFESSIONNELLE » et les
 * coordonnees recouvraient la mention de pied. On mesure donc soi-meme.
 *
 * A appeler APRES avoir pose la police et le corps : `widthOfString` mesure
 * avec la police courante.
 */
function ajuster(doc, texte, largeur) {
  const propre = nettoyer(texte);
  if (!propre) return '';
  if (doc.widthOfString(propre) <= largeur) return propre;
  let coupe = propre;
  while (coupe.length > 1 && doc.widthOfString(`${coupe}...`) > largeur) {
    coupe = coupe.slice(0, -1);
  }
  return `${coupe.trimEnd()}...`;
}

const FORMATS_IMPRIMABLES = ['.png', '.jpg', '.jpeg'];

function cheminImage(relatif) {
  if (!relatif) return null;
  if (!FORMATS_IMPRIMABLES.includes(path.extname(relatif).toLowerCase())) return null;
  const racine = path.join(__dirname, '..', '..');
  const complet = path.resolve(racine, relatif.replace(/^\/+/, ''));
  if (!complet.startsWith(racine)) return null;
  return fs.existsSync(complet) ? complet : null;
}

// Les images embarquees passent par leur version reduite.
//
// Sans cela, le logo par defaut de 1,4 Mo et les photos de telephone partent en
// pleine resolution dans le PDF : une planche de neuf badges pesait 1,96 Mo
// pour une image imprimee dans un carre de 8 millimetres. Le meme piege que
// pour les rapports, retrouve ici parce que ce service ne passait pas par la
// meme porte.
function imagePreparee(relatif, coteMax) {
  const complet = cheminImage(relatif);
  if (!complet) return null;
  try {
    return versionReduite(relatif, coteMax) || complet;
  } catch {
    return complet;
  }
}

/** Rectangle a coins arrondis, utilise pour le cadre et la photo. */
function rectangleArrondi(doc, x, y, largeur, hauteur, rayon) {
  doc.roundedRect(x, y, largeur, hauteur, rayon);
}

/**
 * Dessine un badge a la position donnee.
 * `qr` est un PNG deja produit : la generation est asynchrone, elle est faite
 * en amont pour que le trace reste synchrone et lisible.
 */
function dessinerBadge(doc, x, y, { employe, etablissement, qr, logo }) {
  const L = BADGE.largeur;
  const H = BADGE.hauteur;
  const marge = 9;

  // Cadre. Le fond blanc explicite evite qu'un badge imprime sur papier teinte
  // laisse transparaitre la couleur du support derriere la photo.
  doc.save();
  rectangleArrondi(doc, x, y, L, H, 7);
  doc.fillColor('#ffffff').fill();
  rectangleArrondi(doc, x, y, L, H, 7);
  doc.lineWidth(0.6).strokeColor(COULEUR.bord).stroke();
  doc.restore();

  /* --- Bandeau superieur --- */
  const hauteurBandeau = 42;
  doc.save();
  rectangleArrondi(doc, x, y, L, hauteurBandeau + 7, 7);
  doc.fillColor(COULEUR.bandeau).fill();
  // Le bas du bandeau est reequarri : les coins arrondis ne doivent apparaitre
  // qu'en haut, la ou ils suivent le bord de la carte.
  doc.rect(x, y + hauteurBandeau - 4, L, 4).fillColor(COULEUR.bandeau).fill();
  // Filet clair en pied de bandeau : il donne une assise a l'aplat, qui sans
  // lui se lit comme un rectangle colle en haut de la carte.
  doc.rect(x, y + hauteurBandeau, L, 1.6).fillColor(COULEUR.bandeauClair).fill();
  doc.restore();

  let xTexte = x + marge;
  if (logo) {
    try {
      doc.image(logo, x + marge, y + 9, { fit: [22, 22] });
      xTexte = x + marge + 27;
    } catch {
      // Logo illisible : le bandeau garde son texte, le badge reste utilisable.
    }
  }

  const largeurBandeau = L - (xTexte - x) - marge;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(COULEUR.bandeauTexte);
  doc.text(
    ajuster(doc, (etablissement.etablissement_nom || 'MACHIBEL').toUpperCase(), largeurBandeau),
    xTexte, y + 11, { width: largeurBandeau, lineBreak: false }
  );

  const activite = etablissement.etablissement_activite || etablissement.etablissement_ville;
  if (activite) {
    doc.font('Helvetica').fontSize(5.5).fillColor(COULEUR.bandeauTexteDoux);
    doc.text(ajuster(doc, activite, largeurBandeau), xTexte, y + 21,
      { width: largeurBandeau, lineBreak: false });
  }

  doc.font('Helvetica-Bold').fontSize(5.5).fillColor(COULEUR.bandeauTexteDoux)
    .text('CARTE PROFESSIONNELLE', xTexte, y + 30,
      { width: largeurBandeau, characterSpacing: 0.7, lineBreak: false });

  /* --- Photo --- */
  // La photo occupe l'espace disponible entre le bandeau et la bande basse :
  // un visage plus grand se reconnait de plus loin, et c'est la premiere chose
  // qu'on regarde sur un badge.
  const photoL = 66;
  const photoH = 82;
  const photoX = x + (L - photoL) / 2;
  const photoY = y + hauteurBandeau + 8;

  doc.save();
  rectangleArrondi(doc, photoX, photoY, photoL, photoH, 5);
  doc.fillColor(COULEUR.fondPhoto).fill();
  doc.restore();

  const photo = imagePreparee(employe.photo, TAILLES.moyen);
  if (photo) {
    try {
      // Le rognage est indispensable : sans lui, une photo au mauvais rapport
      // deborde du cadre et recouvre le nom.
      doc.save();
      rectangleArrondi(doc, photoX, photoY, photoL, photoH, 5);
      doc.clip();
      doc.image(photo, photoX, photoY, { cover: [photoL, photoH], align: 'center', valign: 'center' });
      doc.restore();
    } catch {
      doc.restore();
    }
  } else {
    // Sans photo, les initiales valent mieux qu'un rectangle vide : elles
    // permettent au moins de distinguer deux badges d'un coup d'oeil.
    const initiales = `${(employe.prenom || '?')[0]}${(employe.nom || '')[0] || ''}`.toUpperCase();
    doc.font('Helvetica-Bold').fontSize(26).fillColor(COULEUR.tresDoux)
      .text(initiales, photoX, photoY + photoH / 2 - 13, { width: photoL, align: 'center' });
  }

  doc.save();
  rectangleArrondi(doc, photoX, photoY, photoL, photoH, 5);
  doc.lineWidth(0.6).strokeColor(COULEUR.bord).stroke();
  doc.restore();

  /* --- Identite --- */
  const yNom = photoY + photoH + 7;
  const largeurIdentite = L - 10;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COULEUR.texte);
  doc.text(
    ajuster(doc, `${employe.prenom} ${employe.nom}`.toUpperCase(), largeurIdentite),
    x + 5, yNom, { width: largeurIdentite, align: 'center', lineBreak: false }
  );

  doc.font('Helvetica').fontSize(7).fillColor(COULEUR.doux);
  doc.text(ajuster(doc, employe.fonction || 'Personnel', largeurIdentite),
    x + 5, yNom + 11.5, { width: largeurIdentite, align: 'center', lineBreak: false });

  // Telephone de la personne. Sur un badge d'entreprise c'est l'information la
  // plus consultee apres le nom : elle evite de passer par un annuaire pour
  // joindre un collegue, et permet de rappeler le porteur quand la carte est
  // retrouvee.
  if (employe.telephone) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(COULEUR.bandeau);
    doc.text(ajuster(doc, employe.telephone, largeurIdentite), x + 5, yNom + 21.5,
      { width: largeurIdentite, align: 'center', lineBreak: false });
  }

  /* --- Bande basse : matricule a gauche, QR a droite --- */
  const hauteurPied = 21;
  const yBas = y + H - hauteurPied - 46;

  doc.save();
  doc.moveTo(x + marge, yBas - 4).lineTo(x + L - marge, yBas - 4)
    .lineWidth(0.5).strokeColor(COULEUR.bord).stroke();
  doc.restore();

  doc.font('Helvetica').fontSize(5.5).fillColor(COULEUR.tresDoux)
    .text('MATRICULE', x + marge, yBas + 1, { characterSpacing: 0.6, lineBreak: false });
  doc.font('Courier-Bold').fontSize(12).fillColor(COULEUR.texte)
    .text(employe.matricule, x + marge, yBas + 9, { lineBreak: false });

  if (employe.date_embauche) {
    doc.font('Helvetica').fontSize(5.5).fillColor(COULEUR.tresDoux)
      .text(`Depuis le ${formatDateCourte(employe.date_embauche)}`, x + marge, yBas + 24,
        { width: L - marge * 2 - 44, lineBreak: false });
  }

  if (qr) {
    try {
      const taille = 38;
      doc.image(qr, x + L - marge - taille, yBas + 2, { fit: [taille, taille] });
    } catch {
      // Sans QR, le badge reste valable a la lecture humaine.
    }
  }

  /* --- Pied : coordonnees de l'etablissement --- */
  // Un badge se perd. Sans un numero a appeler, la personne qui le ramasse n'a
  // aucun moyen de savoir a qui le rendre - et la carte finit a la poubelle.
  const yPied = y + H - hauteurPied;
  doc.save();
  doc.rect(x, yPied, L, hauteurPied - 3.5).fillColor(COULEUR.fondPied).fill();
  // Le bas du pied suit l'arrondi de la carte.
  rectangleArrondi(doc, x, yPied, L, hauteurPied, 7);
  doc.fillColor(COULEUR.fondPied).fill();
  doc.restore();

  const largeurPied = L - marge * 2;
  const contact = contactEtablissement(etablissement);

  if (contact) {
    doc.font('Helvetica-Bold').fontSize(5).fillColor(COULEUR.doux);
    doc.text(ajuster(doc, contact, largeurPied), x + marge, yPied + 4.5,
      { width: largeurPied, align: 'center', lineBreak: false });
  }

  doc.font('Helvetica').fontSize(4.6).fillColor(COULEUR.tresDoux);
  doc.text(
    ajuster(doc, 'Carte personnelle - a restituer au depart.', largeurPied),
    x + marge, yPied + (contact ? 11.5 : 7),
    { width: largeurPied, align: 'center', lineBreak: false }
  );
}

/** Traits de coupe discrets, pour decouper la planche proprement. */
function traitsDeCoupe(doc, x, y) {
  const longueur = 5;
  doc.save().lineWidth(0.35).strokeColor(COULEUR.decoupe);
  for (const [cx, cy] of [[x, y], [x + BADGE.largeur, y], [x, y + BADGE.hauteur], [x + BADGE.largeur, y + BADGE.hauteur]]) {
    doc.moveTo(cx - longueur, cy).lineTo(cx + longueur, cy).stroke();
    doc.moveTo(cx, cy - longueur).lineTo(cx, cy + longueur).stroke();
  }
  doc.restore();
}

/**
 * Planche de badges A4.
 * @param {Array} employes  fiches, avec `fonction` deja resolue
 */
async function creerPlancheBadges(employes, etablissement) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    info: {
      Title: nettoyer(`Badges - ${etablissement.etablissement_nom || 'MACHIBEL'}`),
      Author: nettoyer(etablissement.etablissement_nom || 'MACHIBEL'),
      Creator: 'MACHIBEL - Gestion de parfumerie',
      CreationDate: new Date(),
    },
  });

  const logo = imagePreparee(etablissement.logo_path, TAILLES.impression);

  // Les QR sont produits en amont : leur generation est asynchrone alors que le
  // trace pdfkit est synchrone. Les melanger produirait des pages vides.
  const qrs = await Promise.all(
    employes.map((e) => qrEnPng(jetonBadge(e.matricule), { taille: 240 }).catch(() => null))
  );

  const largeurGrille = GRILLE.colonnes * BADGE.largeur + (GRILLE.colonnes - 1) * GRILLE.ecart;
  const hauteurGrille = GRILLE.rangees * BADGE.hauteur + (GRILLE.rangees - 1) * GRILLE.ecart;
  const departX = (PAGE.largeur - largeurGrille) / 2;
  const departY = (PAGE.hauteur - hauteurGrille) / 2;

  const parPage = GRILLE.colonnes * GRILLE.rangees;

  employes.forEach((employe, index) => {
    const position = index % parPage;
    if (index > 0 && position === 0) doc.addPage();

    const colonne = position % GRILLE.colonnes;
    const rangee = Math.floor(position / GRILLE.colonnes);
    const x = departX + colonne * (BADGE.largeur + GRILLE.ecart);
    const y = departY + rangee * (BADGE.hauteur + GRILLE.ecart);

    traitsDeCoupe(doc, x, y);
    dessinerBadge(doc, x, y, { employe, etablissement, qr: qrs[index], logo });
  });

  return doc;
}

module.exports = { creerPlancheBadges, BADGE, GRILLE };
