const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { preparerLogo } = require('./images.service');

/**
 * Moteur de documents imprimables.
 *
 * Un rapport qui sort d'ici est remis a un banquier, a un comptable ou classe
 * dans un dossier papier. Il doit donc se tenir comme un document d'entreprise :
 * entete identifiant l'etablissement, pagination "Page X sur Y", typographie
 * dense mais lisible, et une mise en page qui survit a une table de 400 lignes.
 *
 * Aucune police externe n'est chargee : les quatorze polices de base du format
 * PDF (Helvetica et consorts) sont presentes dans tous les lecteurs. Le fichier
 * pese donc quelques dizaines de kilo-octets et s'ouvre partout, y compris sur
 * un telephone bas de gamme.
 */

/* --- Metriques ----------------------------------------------------------- */

// A4 en points typographiques (72 pt = 1 pouce) : 210 x 297 mm.
const PAGE = { largeur: 595.28, hauteur: 841.89 };

// Marges. Les documents administratifs francais tiennent 20 mm sur les cotes ;
// on descend a 16 mm parce que ces rapports sont surtout des tableaux, et que
// chaque millimetre gagne en largeur evite une colonne tronquee.
const MARGE = { haut: 40, bas: 56, gauche: 45, droite: 45 };
const LARGEUR_UTILE = PAGE.largeur - MARGE.gauche - MARGE.droite;

// Corps de texte. La norme des documents imprimes situe le texte courant entre
// 10 et 12 pt ; les tableaux financiers denses (rapports annuels, balances
// comptables) descendent couramment a 8-9 pt, ce qui reste lisible a bout de
// bras. On se cale la : titres hierarchises, corps a 9, tableaux a 8,5.
const TAILLE = {
  titreDocument: 16,
  sousTitre: 9.5,
  section: 9.5,
  corps: 9,
  tableauEntete: 8,
  tableauCorps: 8.5,
  etablissementNom: 13,
  petit: 7.5,
  pied: 7,
};

// Interlignage a ~1,35 fois le corps : en dessous les lignes se collent, au
// dessus le tableau s'etale sur trop de pages.
const INTERLIGNE = 1.35;

const COULEUR = {
  texte: '#111827',
  doux: '#4b5563',
  tresDoux: '#6b7280',
  filet: '#d1d5db',
  filetFort: '#9ca3af',
  fondEntete: '#f3f4f6',
  fondAlterne: '#fafafa',
  accent: '#1b5fd0',
  positif: '#15803d',
  negatif: '#b91c1c',
};

// pdfkit encode les polices de base en WinAnsi, qui ne couvre pas tout Unicode.
// `toLocaleString('fr-FR')` produit une espace fine insecable (U+202F) et les
// saisies libres peuvent contenir n'importe quoi : sans ce filtre, un caractere
// hors jeu fait planter la generation ou imprime un glyphe parasite.
const REMPLACEMENTS = {
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', '•': '-',
};

function nettoyer(valeur) {
  if (valeur === null || valeur === undefined) return '';
  let texte = String(valeur);
  for (const [source, cible] of Object.entries(REMPLACEMENTS)) {
    texte = texte.split(source).join(cible);
  }
  // Filet de securite : tout ce qui sort de Latin-1 est retire plutot que de
  // faire echouer la generation d'un rapport entier pour un emoji colle dans
  // une note de depense.
  return texte.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

/* --- Formats ------------------------------------------------------------- */

// Separateur de milliers pose a la main : `toLocaleString` renvoie une espace
// fine insecable que la police de base ne sait pas dessiner.
function separerMilliers(entier) {
  return String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatNombre(valeur, decimales = 0) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '-';
  const signe = n < 0 ? '-' : '';
  const absolu = Math.abs(n);
  const fixe = absolu.toFixed(decimales);
  const [entier, fraction] = fixe.split('.');
  return signe + separerMilliers(entier) + (fraction ? `,${fraction}` : '');
}

function formatMontant(valeur, devise = 'FCFA') {
  return `${formatNombre(valeur, 0)} ${devise}`;
}

function formatQuantite(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '-';
  // Une quantite entiere s'ecrit sans decimales : "12" et non "12,00".
  return Number.isInteger(n) ? formatNombre(n, 0) : formatNombre(n, 2);
}

function formatPourcentage(valeur, decimales = 1) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '-';
  const signe = n > 0 ? '+' : '';
  return `${signe}${formatNombre(n, decimales)} %`;
}

// Le code du projet s'ecrit sans accents, mais ces chaines-la ne sont pas du
// code : elles sont imprimees sur un document remis a un tiers. Les polices de
// base couvrent Latin-1, donc les accents passent - et un rapport professionnel
// ecrit "fevrier" se remarque tout de suite.
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function versDate(valeur) {
  if (!valeur) return null;
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d;
}

function deuxChiffres(n) {
  return String(n).padStart(2, '0');
}

function formatDateCourte(valeur) {
  const d = versDate(valeur);
  if (!d) return '-';
  return `${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateHeure(valeur) {
  const d = versDate(valeur);
  if (!d) return '-';
  return `${formatDateCourte(d)} ${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
}

function formatDateLongue(valeur) {
  const d = versDate(valeur);
  if (!d) return '-';
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/* --- Logo ---------------------------------------------------------------- */

// pdfkit n'embarque que du PNG et du JPEG. Le logo peut avoir ete televerse en
// SVG ou en WebP (les deux sont acceptes par l'interface) : dans ce cas on
// imprime l'entete sans image plutot que de faire echouer tout le rapport.
const FORMATS_IMPRIMABLES = ['.png', '.jpg', '.jpeg'];

function resoudreLogo(logoPath) {
  if (!logoPath) return null;
  const extension = path.extname(logoPath).toLowerCase();
  if (!FORMATS_IMPRIMABLES.includes(extension)) return null;

  const racine = path.join(__dirname, '..', '..');
  const chemin = path.resolve(racine, logoPath.replace(/^\/+/, ''));
  // Le chemin vient de la base : on verifie qu'il ne sort pas du dossier du
  // backend avant de le lire.
  if (!chemin.startsWith(racine)) return null;
  if (!fs.existsSync(chemin)) return null;

  // Le logo d'ecran est bien trop defini pour un carre de 52 points : sans cette
  // reduction, il represente a lui seul l'essentiel du poids du document.
  return preparerLogo(chemin);
}

/* --- Document ------------------------------------------------------------ */

class DocumentRapport {
  /**
   * @param {object} options
   * @param {object} options.etablissement  ligne `parametres` (nom, adresse, telephones...)
   * @param {string} options.titre          titre du document
   * @param {string} [options.sousTitre]    precision sous le titre
   * @param {string} [options.periode]      periode couverte, deja mise en forme
   * @param {string} [options.auteur]       personne qui a demande le document
   */
  constructor({ etablissement = {}, titre, sousTitre = '', periode = '', auteur = '' }) {
    this.etablissement = etablissement;
    this.titre = titre;
    this.sousTitre = sousTitre;
    this.periode = periode;
    this.auteur = auteur;
    this.devise = etablissement.devise || 'FCFA';
    this.genereLe = new Date();

    this.doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGE.haut, bottom: MARGE.bas, left: MARGE.gauche, right: MARGE.droite },
      // Indispensable pour ecrire "Page X sur Y" : le total n'est connu qu'une
      // fois le document entierement compose.
      bufferPages: true,
      info: {
        Title: nettoyer(titre),
        Author: nettoyer(etablissement.etablissement_nom || 'MACHIBEL'),
        Creator: 'MACHIBEL - Gestion de parfumerie',
        CreationDate: this.genereLe,
      },
    });

    // Les pages suivantes portent un bandeau compact au lieu de l'entete
    // complet : reproduire le pave d'adresse sur trente pages gaspille un tiers
    // de chaque feuille.
    this.doc.on('pageAdded', () => this.enteteCourant());

    this.enteteComplet();
  }

  /* --- Primitives ------------------------------------------------------- */

  get y() { return this.doc.y; }
  set y(valeur) { this.doc.y = valeur; }

  // Hauteur restante avant la zone de pied de page.
  get placeRestante() {
    return PAGE.hauteur - MARGE.bas - this.doc.y;
  }

  // Force un saut de page si le bloc a venir ne tient pas. Sans cela, pdfkit
  // coupe au milieu d'un titre de section et laisse l'intitule orphelin en bas
  // de page.
  reserver(hauteur) {
    if (this.placeRestante < hauteur) this.doc.addPage();
  }

  filet(epaisseur = 0.5, couleur = COULEUR.filet) {
    this.doc.save()
      .moveTo(MARGE.gauche, this.doc.y)
      .lineTo(PAGE.largeur - MARGE.droite, this.doc.y)
      .lineWidth(epaisseur)
      .strokeColor(couleur)
      .stroke()
      .restore();
  }

  /* --- Entetes ---------------------------------------------------------- */

  enteteComplet() {
    const e = this.etablissement;
    const doc = this.doc;
    const hautDepart = MARGE.haut;

    const logo = resoudreLogo(e.logo_path);
    let xTexte = MARGE.gauche;
    const tailleLogo = 52;

    if (logo) {
      try {
        doc.image(logo, MARGE.gauche, hautDepart, { fit: [tailleLogo, tailleLogo], align: 'left' });
        xTexte = MARGE.gauche + tailleLogo + 14;
      } catch {
        // Fichier illisible ou corrompu : l'entete se passe du logo. Un rapport
        // sans image reste utilisable, un rapport qui n'existe pas ne l'est pas.
      }
    }

    const largeurTexte = PAGE.largeur - MARGE.droite - xTexte;

    doc.fillColor(COULEUR.texte)
      .font('Helvetica-Bold').fontSize(TAILLE.etablissementNom)
      .text(nettoyer(e.etablissement_nom || 'MACHIBEL'), xTexte, hautDepart, { width: largeurTexte });

    if (e.etablissement_slogan) {
      doc.font('Helvetica-Oblique').fontSize(TAILLE.petit).fillColor(COULEUR.tresDoux)
        .text(nettoyer(e.etablissement_slogan), xTexte, doc.y + 1, { width: largeurTexte });
    }
    if (e.etablissement_activite) {
      doc.font('Helvetica').fontSize(TAILLE.petit).fillColor(COULEUR.doux)
        .text(nettoyer(e.etablissement_activite), xTexte, doc.y + 1, { width: largeurTexte });
    }

    // Coordonnees : chaque ligne ne s'imprime que si elle est renseignee, sinon
    // l'entete se remplit de separateurs vides.
    const lieu = [e.etablissement_adresse, e.etablissement_quartier, e.etablissement_ville, e.etablissement_pays]
      .filter(Boolean).map(nettoyer).join(', ');
    const boite = e.etablissement_boite_postale ? `BP ${nettoyer(e.etablissement_boite_postale)}` : '';
    const telephones = [e.etablissement_telephone, e.etablissement_telephone_2]
      .filter(Boolean).map(nettoyer).join(' / ');
    const contacts = [
      telephones ? `Tel. ${telephones}` : '',
      e.etablissement_email ? nettoyer(e.etablissement_email) : '',
      e.etablissement_site_web ? nettoyer(e.etablissement_site_web) : '',
    ].filter(Boolean).join('  -  ');
    const legal = [
      e.etablissement_registre_commerce ? `RC ${nettoyer(e.etablissement_registre_commerce)}` : '',
      e.etablissement_identifiant_fiscal ? `NIU ${nettoyer(e.etablissement_identifiant_fiscal)}` : '',
      e.etablissement_capital ? `Capital ${nettoyer(e.etablissement_capital)}` : '',
    ].filter(Boolean).join('  -  ');

    doc.font('Helvetica').fontSize(TAILLE.pied).fillColor(COULEUR.doux);
    for (const ligne of [[lieu, boite].filter(Boolean).join(' - '), contacts, legal]) {
      if (ligne) doc.text(ligne, xTexte, doc.y + 1.5, { width: largeurTexte });
    }

    // L'entete se termine sous le plus bas des deux blocs : le logo peut
    // descendre plus bas que le texte si les coordonnees sont peu remplies.
    const basLogo = logo ? hautDepart + tailleLogo : 0;
    doc.y = Math.max(doc.y, basLogo) + 10;

    this.filet(1, COULEUR.filetFort);
    doc.y += 16;

    this.blocTitre();
  }

  blocTitre() {
    const doc = this.doc;

    doc.font('Helvetica-Bold').fontSize(TAILLE.titreDocument).fillColor(COULEUR.texte)
      .text(nettoyer(this.titre), MARGE.gauche, doc.y, { width: LARGEUR_UTILE });

    if (this.sousTitre) {
      doc.font('Helvetica').fontSize(TAILLE.sousTitre).fillColor(COULEUR.doux)
        .text(nettoyer(this.sousTitre), MARGE.gauche, doc.y + 3, { width: LARGEUR_UTILE });
    }

    // Bandeau d'identification du tirage : sans lui, deux impressions du meme
    // rapport a deux dates sont indiscernables une fois posees sur un bureau.
    const mentions = [
      this.periode ? `Période : ${nettoyer(this.periode)}` : 'Toutes périodes confondues',
      `Édité le ${formatDateLongue(this.genereLe)} à ${deuxChiffres(this.genereLe.getHours())}:${deuxChiffres(this.genereLe.getMinutes())}`,
      this.auteur ? `Par ${nettoyer(this.auteur)}` : '',
    ].filter(Boolean);

    doc.y += 8;
    const hauteurBandeau = 16;
    doc.save()
      .rect(MARGE.gauche, doc.y, LARGEUR_UTILE, hauteurBandeau)
      .fillColor(COULEUR.fondEntete).fill()
      .restore();
    doc.font('Helvetica').fontSize(TAILLE.pied).fillColor(COULEUR.doux)
      .text(mentions.join('     |     '), MARGE.gauche + 7, doc.y + 5, {
        width: LARGEUR_UTILE - 14, lineBreak: false, ellipsis: true,
      });

    doc.y += hauteurBandeau + 14;
  }

  enteteCourant() {
    const doc = this.doc;
    const e = this.etablissement;

    doc.font('Helvetica-Bold').fontSize(TAILLE.pied).fillColor(COULEUR.doux)
      .text(nettoyer(e.etablissement_nom || 'MACHIBEL'), MARGE.gauche, MARGE.haut - 12, {
        width: LARGEUR_UTILE / 2, lineBreak: false,
      });
    doc.font('Helvetica').fontSize(TAILLE.pied).fillColor(COULEUR.tresDoux)
      .text(nettoyer(this.titre), MARGE.gauche + LARGEUR_UTILE / 2, MARGE.haut - 12, {
        width: LARGEUR_UTILE / 2, align: 'right', lineBreak: false, ellipsis: true,
      });

    doc.y = MARGE.haut + 2;
    this.filet(0.5);
    doc.y += 12;
  }

  /* --- Blocs de contenu -------------------------------------------------- */

  titreSection(texte) {
    // 26 pt : la hauteur du titre plus au moins une ligne de ce qui suit, pour
    // ne jamais laisser un intitule seul en bas de page.
    this.reserver(46);
    const doc = this.doc;
    doc.font('Helvetica-Bold').fontSize(TAILLE.section).fillColor(COULEUR.accent)
      .text(nettoyer(texte).toUpperCase(), MARGE.gauche, doc.y, {
        width: LARGEUR_UTILE, characterSpacing: 0.6,
      });
    doc.y += 3;
    this.filet(0.75, COULEUR.accent);
    doc.y += 9;
  }

  paragraphe(texte, { italique = false } = {}) {
    const doc = this.doc;
    doc.font(italique ? 'Helvetica-Oblique' : 'Helvetica')
      .fontSize(TAILLE.corps).fillColor(COULEUR.doux)
      .text(nettoyer(texte), MARGE.gauche, doc.y, {
        width: LARGEUR_UTILE, lineGap: TAILLE.corps * (INTERLIGNE - 1),
      });
    doc.y += 8;
  }

  /**
   * Grille de chiffres cles. `cartes` : [{ libelle, valeur, note?, ton? }]
   * `ton` vaut 'positif' | 'negatif' | undefined.
   */
  chiffresCles(cartes, colonnes = 3) {
    if (!cartes.length) return;
    const doc = this.doc;
    const ecart = 10;
    const largeur = (LARGEUR_UTILE - ecart * (colonnes - 1)) / colonnes;
    const hauteur = 46;

    for (let i = 0; i < cartes.length; i += colonnes) {
      const rangee = cartes.slice(i, i + colonnes);
      this.reserver(hauteur + 10);
      const yRangee = doc.y;

      rangee.forEach((carte, index) => {
        const x = MARGE.gauche + index * (largeur + ecart);
        doc.save()
          .rect(x, yRangee, largeur, hauteur)
          .lineWidth(0.5).strokeColor(COULEUR.filet).stroke()
          .restore();

        doc.font('Helvetica').fontSize(TAILLE.pied).fillColor(COULEUR.tresDoux)
          .text(nettoyer(carte.libelle).toUpperCase(), x + 8, yRangee + 7, {
            width: largeur - 16, characterSpacing: 0.4, lineBreak: false, ellipsis: true,
          });

        const couleurValeur = carte.ton === 'positif' ? COULEUR.positif
          : carte.ton === 'negatif' ? COULEUR.negatif : COULEUR.texte;
        doc.font('Helvetica-Bold').fontSize(13).fillColor(couleurValeur)
          .text(nettoyer(carte.valeur), x + 8, yRangee + 19, {
            width: largeur - 16, lineBreak: false, ellipsis: true,
          });

        if (carte.note) {
          doc.font('Helvetica').fontSize(TAILLE.pied).fillColor(COULEUR.tresDoux)
            .text(nettoyer(carte.note), x + 8, yRangee + 34, {
              width: largeur - 16, lineBreak: false, ellipsis: true,
            });
        }
      });

      doc.y = yRangee + hauteur + ecart;
    }
    doc.y += 4;
  }

  /**
   * Liste cle/valeur sur deux colonnes, pour une fiche d'identite.
   * `paires` : [{ cle, valeur }]
   */
  fiche(paires) {
    const doc = this.doc;
    const largeurCle = 150;
    for (const paire of paires) {
      if (paire.valeur === null || paire.valeur === undefined || paire.valeur === '') continue;
      this.reserver(18);
      const y = doc.y;
      doc.font('Helvetica').fontSize(TAILLE.corps).fillColor(COULEUR.tresDoux)
        .text(nettoyer(paire.cle), MARGE.gauche, y, { width: largeurCle, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(TAILLE.corps).fillColor(COULEUR.texte)
        .text(nettoyer(paire.valeur), MARGE.gauche + largeurCle, y, {
          width: LARGEUR_UTILE - largeurCle,
        });
      doc.y = Math.max(doc.y, y + TAILLE.corps * INTERLIGNE) + 2;
    }
    doc.y += 6;
  }

  /**
   * Tableau paginant tout seul, avec repetition de l'entete sur chaque page.
   *
   * @param {object} options
   * @param {Array}  options.colonnes  [{ titre, cle, largeur, alignement, format }]
   *   `largeur` est une part relative (les parts sont normalisees sur la largeur
   *   utile), `alignement` vaut 'left' | 'right' | 'center',
   *   `format` est une fonction (valeur, ligne) => string appliquee a la valeur
   *   lue sous `cle`, `calcule` une fonction (ligne) => string pour une colonne
   *   qui n'a pas de colonne correspondante dans la requete.
   * @param {Array}  options.lignes    donnees brutes
   * @param {Array}  [options.total]   ligne de total, meme forme qu'une ligne
   * @param {string} [options.vide]    message si aucune ligne
   */
  tableau({ colonnes, lignes, total = null, vide = 'Aucune donnée sur cette période.' }) {
    const doc = this.doc;

    if (!lignes.length) {
      this.paragraphe(vide, { italique: true });
      return;
    }

    const sommeParts = colonnes.reduce((s, c) => s + (c.largeur || 1), 0);
    const largeurs = colonnes.map((c) => ((c.largeur || 1) / sommeParts) * LARGEUR_UTILE);
    const positions = [];
    let curseur = MARGE.gauche;
    for (const l of largeurs) { positions.push(curseur); curseur += l; }

    const remplissage = 4.5;
    const hauteurEntete = TAILLE.tableauEntete * INTERLIGNE + remplissage * 2;

    const dessinerEntete = () => {
      const y = doc.y;
      doc.save().rect(MARGE.gauche, y, LARGEUR_UTILE, hauteurEntete)
        .fillColor(COULEUR.fondEntete).fill().restore();
      doc.font('Helvetica-Bold').fontSize(TAILLE.tableauEntete).fillColor(COULEUR.texte);
      colonnes.forEach((c, i) => {
        doc.text(nettoyer(c.titre), positions[i] + remplissage, y + remplissage, {
          width: largeurs[i] - remplissage * 2,
          align: c.alignement || 'left',
          lineBreak: false,
          ellipsis: true,
        });
      });
      doc.y = y + hauteurEntete;
      doc.save().moveTo(MARGE.gauche, doc.y).lineTo(PAGE.largeur - MARGE.droite, doc.y)
        .lineWidth(0.75).strokeColor(COULEUR.filetFort).stroke().restore();
    };

    const valeurCellule = (colonne, ligne) => {
      const brute = ligne[colonne.cle];

      // Colonne calculee : sa valeur se deduit de la ligne entiere et non d'une
      // colonne de la requete ("Nom et prenom" a partir de `nom` et `prenom`).
      // Sa cle ne designe alors rien dans les lignes de donnees - elle ne sert
      // qu'a viser la cellule depuis la ligne de total, qui elle la renseigne.
      //
      // Ce cas doit passer AVANT le test d'absence ci-dessous : sans cela une
      // colonne calculee sortait systematiquement vide, et le registre du
      // personnel s'imprimait sans aucun nom.
      if (colonne.calcule) {
        return nettoyer(brute !== undefined ? brute : colonne.calcule(ligne));
      }

      // Une cellule vide reste vide : appliquer le format a une valeur absente
      // imprime "Invalid Date" ou "0 FCFA" dans les cases qu'une ligne de total
      // laisse volontairement blanches.
      if (brute === null || brute === undefined || brute === '') {
        return colonne.videPar ?? '';
      }
      return nettoyer(colonne.format ? colonne.format(brute, ligne) : brute);
    };

    // La hauteur d'une ligne depend du texte le plus long qui doit passer a la
    // ligne : on la mesure avant de dessiner, sinon les fonds alternes et les
    // filets se decalent du contenu.
    const hauteurLigne = (ligne) => {
      doc.font('Helvetica').fontSize(TAILLE.tableauCorps);
      let maximum = TAILLE.tableauCorps * INTERLIGNE;
      colonnes.forEach((c, i) => {
        if (c.uneLigne) return;
        const h = doc.heightOfString(valeurCellule(c, ligne), { width: largeurs[i] - remplissage * 2 });
        if (h > maximum) maximum = h;
      });
      return maximum + remplissage * 2;
    };

    const dessinerLigne = (ligne, index, { gras = false } = {}) => {
      const hauteur = hauteurLigne(ligne);
      // Le +4 laisse la place au filet de cloture : une derniere ligne collee au
      // bord bas se lit mal.
      if (this.placeRestante < hauteur + 4) {
        doc.addPage();
        dessinerEntete();
      }
      const y = doc.y;

      if (!gras && index % 2 === 1) {
        doc.save().rect(MARGE.gauche, y, LARGEUR_UTILE, hauteur)
          .fillColor(COULEUR.fondAlterne).fill().restore();
      }
      if (gras) {
        doc.save().rect(MARGE.gauche, y, LARGEUR_UTILE, hauteur)
          .fillColor(COULEUR.fondEntete).fill().restore();
      }

      doc.font(gras ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(TAILLE.tableauCorps).fillColor(COULEUR.texte);

      colonnes.forEach((c, i) => {
        const texte = valeurCellule(c, ligne);
        if (c.gras) doc.font('Helvetica-Bold'); else if (!gras) doc.font('Helvetica');
        doc.fillColor(c.couleur ? c.couleur(ligne[c.cle], ligne) : COULEUR.texte);
        doc.text(texte, positions[i] + remplissage, y + remplissage, {
          width: largeurs[i] - remplissage * 2,
          align: c.alignement || 'left',
          lineBreak: !c.uneLigne,
          ellipsis: !!c.uneLigne,
          height: c.uneLigne ? TAILLE.tableauCorps * INTERLIGNE : undefined,
        });
      });

      doc.y = y + hauteur;
      doc.save().moveTo(MARGE.gauche, doc.y).lineTo(PAGE.largeur - MARGE.droite, doc.y)
        .lineWidth(0.25).strokeColor(COULEUR.filet).stroke().restore();
    };

    this.reserver(hauteurEntete + 40);
    dessinerEntete();
    lignes.forEach((ligne, index) => dessinerLigne(ligne, index));
    if (total) dessinerLigne(total, -1, { gras: true });

    doc.y += 12;
  }

  /* --- Cloture ----------------------------------------------------------- */

  /**
   * Numerote toutes les pages puis ferme le document.
   * Le total de pages n'existe qu'une fois la composition terminee : d'ou le
   * `bufferPages` et ce second passage.
   */
  finaliser() {
    const doc = this.doc;
    const plage = doc.bufferedPageRange();
    const mention = this.etablissement.etablissement_mention_pied;

    for (let i = 0; i < plage.count; i += 1) {
      doc.switchToPage(plage.start + i);

      // pdfkit ajoute une page des qu'on ecrit dans la marge basse. On l'annule
      // pendant l'ecriture du pied, sinon numeroter N pages en cree N nouvelles.
      const margesOrigine = doc.page.margins;
      doc.page.margins = { ...margesOrigine, bottom: 0 };

      const yFilet = PAGE.hauteur - MARGE.bas + 18;
      doc.save().moveTo(MARGE.gauche, yFilet).lineTo(PAGE.largeur - MARGE.droite, yFilet)
        .lineWidth(0.5).strokeColor(COULEUR.filet).stroke().restore();

      const yTexte = yFilet + 6;
      const gauche = [
        nettoyer(this.etablissement.etablissement_nom || 'MACHIBEL'),
        mention ? nettoyer(mention) : '',
      ].filter(Boolean).join(' - ');

      doc.font('Helvetica').fontSize(TAILLE.pied).fillColor(COULEUR.tresDoux)
        .text(gauche, MARGE.gauche, yTexte, {
          width: LARGEUR_UTILE * 0.68, lineBreak: false, ellipsis: true,
        })
        .text(`Page ${i + 1} sur ${plage.count}`, MARGE.gauche + LARGEUR_UTILE * 0.68, yTexte, {
          width: LARGEUR_UTILE * 0.32, align: 'right', lineBreak: false,
        });

      doc.page.margins = margesOrigine;
    }

    doc.end();
    return doc;
  }

  /**
   * Envoie le document dans une reponse Express.
   * `enLigne` a true ouvre le PDF dans l'onglet, false force le telechargement.
   *
   * Le document est assemble en memoire avant d'etre emis, au lieu d'etre
   * dirige directement vers la reponse. Deux raisons, et la premiere est
   * visible par l'utilisateur :
   *
   *  - un flux part en `Transfer-Encoding: chunked`, donc sans `Content-Length`.
   *    Le navigateur ne connait alors jamais la taille attendue et la barre de
   *    progression du telechargement reste indeterminee ;
   *  - une erreur survenant en cours d'ecriture arriverait apres l'envoi des
   *    entetes, laissant un fichier tronque qu'aucun lecteur n'ouvrira.
   *
   * Le cout est negligeable : ces rapports pesent quelques centaines de
   * kilo-octets, pas des dizaines de mega-octets.
   */
  envoyer(res, nomFichier, { enLigne = false } = {}) {
    const morceaux = [];
    this.doc.on('data', (morceau) => morceaux.push(morceau));
    this.doc.on('end', () => {
      const corps = Buffer.concat(morceaux);
      const disposition = enLigne ? 'inline' : 'attachment';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', corps.length);
      // Le nom est deja reduit a l'ASCII par `nommerFichier`, mais la forme
      // etendue est fournie aussi : elle est la seule reconnue si le nom venait
      // un jour a porter des accents.
      res.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${nomFichier}"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
      );
      // Un rapport reflete l'etat de la base a l'instant du tirage : le mettre
      // en cache reviendrait a reimprimer des chiffres perimes.
      res.setHeader('Cache-Control', 'no-store');
      res.end(corps);
    });
    this.finaliser();
  }
}

/* --- Nommage des fichiers ------------------------------------------------ */

// Un dossier qui accumule "rapport.pdf", "rapport (1).pdf"... est inexploitable.
// Le nom porte la nature du document et la date du tirage.
function nommerFichier(base, date = new Date()) {
  const horodatage = `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
  const propre = String(base).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${propre}-${horodatage}.pdf`;
}

// Libelle de periode pour le bandeau du titre.
function libellePeriode(from, to) {
  const debut = versDate(from);
  const fin = versDate(to);
  if (debut && fin) return `du ${formatDateCourte(debut)} au ${formatDateCourte(fin)}`;
  if (debut) return `à partir du ${formatDateCourte(debut)}`;
  if (fin) return `jusqu'au ${formatDateCourte(fin)}`;
  return '';
}

module.exports = {
  DocumentRapport,
  nommerFichier,
  libellePeriode,
  formatMontant,
  formatQuantite,
  formatNombre,
  formatPourcentage,
  formatDateCourte,
  formatDateHeure,
  formatDateLongue,
  nettoyer,
  COULEUR,
};
