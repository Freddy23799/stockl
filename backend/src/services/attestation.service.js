const {
  DocumentRapport, nettoyer, formatDateCourte, formatDateLongue, nommerFichier,
} = require('./pdf.service');
const { jetonAttestation, qrEnPng } = require('./verification.service');

// -----------------------------------------------------------------------------
// Attestation de stage.
//
// Contrairement au badge (une carte qu'on porte), l'attestation est un
// document qu'on remet a la fin d'un stage : elle doit se lire comme une
// piece officielle, pas comme une fiche. Le moteur de rapports A4
// (pdf.service.js) fournit deja l'entete etablissement, la typographie et le
// cartouche de verification - on le reutilise plutot que de redessiner une
// mise en page a la main comme le fait badge.service.js pour son format carte.
// -----------------------------------------------------------------------------

function dureeEnJours(debut, fin) {
  const d = new Date(debut);
  const f = new Date(fin);
  if (Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) return null;
  return Math.max(1, Math.round((f - d) / (1000 * 60 * 60 * 24)) + 1);
}

/**
 * Construit le PDF d'une attestation de stage et renvoie son contenu en Buffer.
 *
 * @param {object} params
 * @param {object} params.etablissement  ligne `parametres`
 * @param {object} params.employe        { prenom, nom, matricule, fonction }
 * @param {object} params.document       ligne `stagiaires_documents` (numero, dates, maitre_stage, theme_stage, mention)
 * @param {string} params.auteurNom      nom de la personne qui a genere le document
 */
async function creerAttestationStage({ etablissement, employe, document, auteurNom }) {
  const nomComplet = `${employe.prenom} ${employe.nom}`.trim();
  const duree = dureeEnJours(document.date_debut_stage, document.date_fin_stage);

  const rapport = new DocumentRapport({
    etablissement,
    titre: 'ATTESTATION DE STAGE',
    sousTitre: `Delivree a ${nettoyer(nomComplet)}`,
    auteur: auteurNom,
    sansPeriode: true,
  });
  const doc = rapport.doc;

  rapport.paragraphe(
    `Nous soussignes, ${etablissement.etablissement_nom || 'MACHIBEL'}, attestons que `
    + `${nomComplet}${employe.fonction ? `, ${employe.fonction},` : ','} a effectue un stage `
    + 'au sein de notre etablissement dans les conditions decrites ci-dessous.'
  );
  doc.y += 6;

  rapport.fiche([
    { cle: 'Stagiaire', valeur: nomComplet },
    { cle: 'Fonction / poste', valeur: employe.fonction },
    { cle: 'Periode de stage', valeur: document.date_debut_stage && document.date_fin_stage
      ? `du ${formatDateCourte(document.date_debut_stage)} au ${formatDateCourte(document.date_fin_stage)}`
      : null },
    { cle: 'Duree', valeur: duree ? `${duree} jour${duree > 1 ? 's' : ''}` : null },
    { cle: 'Maitre de stage', valeur: document.maitre_stage },
    { cle: 'Theme du stage', valeur: document.theme_stage },
    { cle: 'Numero d\'attestation', valeur: document.numero },
  ]);

  if (document.mention) {
    doc.y += 2;
    rapport.paragraphe(nettoyer(document.mention), { italique: true });
  }

  doc.y += 4;
  rapport.paragraphe(
    'En foi de quoi, la presente attestation lui est delivree pour servir et valoir ce que de droit.'
  );

  // Bloc signature : un encadre en pointilles, comme sur les recus de paie
  // (recu.service.js) - l'espace vide invite explicitement a signer, la ou
  // un simple mot "Signature" se perd dans le texte.
  doc.y += 10;
  rapport.reserver(70);
  const largeurSignature = 200;
  const xSignature = doc.page.width - 45 - largeurSignature;
  const ySignature = doc.y;

  doc.font('Helvetica').fontSize(9).fillColor('#4b5563')
    .text(`Fait a ${nettoyer(etablissement.etablissement_ville || '')}, le ${formatDateLongue(new Date())}`, 45, ySignature);

  doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
    .text('Le responsable', xSignature, ySignature, { width: largeurSignature, align: 'center' });
  doc.save().roundedRect(xSignature, ySignature + 12, largeurSignature, 46, 3)
    .lineWidth(0.5).strokeColor('#d1d5db').dash(2, { space: 2 }).stroke().restore();

  doc.y = ySignature + 66;

  const qr = await qrEnPng(jetonAttestation(document.numero), { taille: 260 }).catch(() => null);
  rapport.blocVerification(qr, `Attestation ${document.numero}`);

  return await new Promise((resolve) => {
    const morceaux = [];
    doc.on('data', (m) => morceaux.push(m));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    rapport.finaliser();
  });
}

function nomFichierAttestation(employe, date) {
  return nommerFichier(`attestation-stage-${employe.prenom}-${employe.nom}`, date);
}

module.exports = { creerAttestationStage, nomFichierAttestation };
