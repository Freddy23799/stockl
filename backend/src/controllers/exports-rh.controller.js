const pool = require('../config/db');
const {
  DocumentRapport, nommerFichier, libellePeriode,
  formatMontant, formatNombre, formatDateCourte, formatDateHeure,
} = require('../services/pdf.service');
const { creerPlancheBadges } = require('../services/badge.service');
const { creerRecu } = require('../services/recu.service');
const { verifierJeton } = require('../services/verification.service');

/**
 * Documents du personnel : badges, recus de paie, listes et statistiques.
 *
 * Separe des exports commerciaux : ces documents-la portent des donnees
 * nominatives et des montants de salaire, et il vaut mieux que leur code soit
 * lisible d'un coup d'oeil plutot que noye au milieu des rapports de ventes.
 */

async function contexteDocument(req) {
  const [{ rows: parametresRows }, { rows: auteurRows }] = await Promise.all([
    pool.query('SELECT * FROM parametres WHERE id = 1'),
    pool.query('SELECT prenom, nom, nom_utilisateur FROM utilisateurs WHERE id = $1', [req.user.id]),
  ]);
  const auteur = auteurRows[0];
  return {
    etablissement: parametresRows[0] || {},
    auteur: auteur
      ? [auteur.prenom, auteur.nom].filter(Boolean).join(' ') || auteur.nom_utilisateur
      : '',
  };
}

const devise = (e) => e.devise || 'FCFA';

/** Envoie un document pdfkit deja compose, avec sa taille annoncee. */
function envoyerDocument(doc, res, nomFichier) {
  const morceaux = [];
  doc.on('data', (m) => morceaux.push(m));
  doc.on('end', () => {
    const corps = Buffer.concat(morceaux);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', corps.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nomFichier}"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(corps);
  });
  doc.end();
}

/* --- Badges --------------------------------------------------------------- */

// Une selection (`?ids=3,7,12`), un seul employe (`?employe_id=`) ou toute la
// planche. Imprimer neuf badges pour n'en remplacer qu'un gaspillerait huit
// cartes, et les cartes plastifiees coutent cher.
async function badges(req, res) {
  const { etablissement } = await contexteDocument(req);
  const { employe_id, ids } = req.query;

  const conditions = ['e.actif = true'];
  const params = [];

  if (ids) {
    // Les identifiants arrivent en chaine : on les convertit et on ecarte tout
    // ce qui n'est pas un entier, plutot que de laisser passer une valeur qui
    // ferait echouer la requete.
    const liste = String(ids)
      .split(',')
      .map((v) => Number(String(v).trim()))
      .filter((v) => Number.isInteger(v) && v > 0);

    if (!liste.length) {
      return res.status(400).json({ message: 'Aucun employe valide dans la selection' });
    }
    params.push(liste);
    conditions.push(`e.id = ANY($${params.length}::int[])`);
  } else if (employe_id) {
    params.push(employe_id);
    conditions.push(`e.id = $${params.length}`);
  }

  const { rows } = await pool.query(
    // `f.nom` d'abord, `c.fonction` en repli. Un badge est un document VIVANT :
    // reimprime aujourd'hui, il doit porter le titre en vigueur aujourd'hui. Le
    // libelle fige dans la periode de carriere sert aux bulletins de paie, qui
    // eux doivent rester conformes a ce qui a ete verse a l'epoque.
    `SELECT e.id, e.matricule, e.prenom, e.nom, e.photo, e.date_embauche,
            COALESCE(f.nom, c.fonction) AS fonction
       FROM employes e
       LEFT JOIN employes_carriere c ON c.employe_id = e.id AND c.date_fin IS NULL
       LEFT JOIN fonctions f ON f.id = c.fonction_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.nom, e.prenom`,
    params
  );

  if (!rows.length) {
    return res.status(404).json({ message: 'Aucun employe actif a imprimer' });
  }

  const doc = await creerPlancheBadges(rows, etablissement);
  const nom = rows.length === 1 ? `badge-${rows[0].matricule}` : 'badges-employes';
  envoyerDocument(doc, res, nommerFichier(nom));
}

/* --- Recu de paie --------------------------------------------------------- */

async function recu(req, res) {
  const { etablissement } = await contexteDocument(req);

  const { rows } = await pool.query(
    `SELECT v.*,
            l.matricule_snapshot, l.nom_complet_snapshot, l.fonction_snapshot,
            l.salaire_base, l.ajustement_general, l.ajustement_particulier,
            l.ajustement_motif, l.net_a_payer, l.montant_paye,
            c.reference, c.libelle AS cycle_libelle, c.periode_debut, c.periode_fin,
            c.ajustement_motif AS cycle_ajustement_motif
       FROM paie_versements v
       JOIN paie_lignes l ON l.id = v.ligne_id
       JOIN paie_cycles c ON c.id = l.cycle_id
      WHERE v.numero_recu = $1`,
    [String(req.params.numero || '').toUpperCase()]
  );

  const donnees = rows[0];
  if (!donnees) return res.status(404).json({ message: 'Recu introuvable' });

  // `montant_paye` de la ligne porte le cumul d'AUJOURD'HUI. Le recu, lui, doit
  // annoncer l'etat au moment ou il a ete emis : un acompte reimprime apres le
  // solde afficherait sinon un reste du de zero.
  //
  // Le cumul se borne sur l'identifiant, jamais sur l'horodatage. `paye_le`
  // revient en JavaScript avec une precision a la milliseconde alors que
  // PostgreSQL stocke des microsecondes : la valeur relue est infimement
  // anterieure a celle en base, et un `paye_le <= $2` excluait le versement
  // courant de sa propre somme. Le "deja verse" ressortait alors negatif.
  const { rows: cumulRows } = await pool.query(
    `SELECT COALESCE(SUM(montant), 0) AS cumul
       FROM paie_versements WHERE ligne_id = $1 AND id <= $2`,
    [donnees.ligne_id, donnees.id]
  );

  // Tous les versements de la periode, pour que le recu montre le parcours
  // complet plutot que le seul paiement du jour.
  const { rows: versements } = await pool.query(
    `SELECT id, numero_recu, montant, mode_paiement, est_solde, paye_le
       FROM paie_versements WHERE ligne_id = $1 ORDER BY id`,
    [donnees.ligne_id]
  );

  const doc = await creerRecu({
    etablissement,
    versement: {
      numero_recu: donnees.numero_recu,
      montant: donnees.montant,
      mode_paiement: donnees.mode_paiement,
      est_solde: donnees.est_solde,
      paye_le: donnees.paye_le,
    },
    ligne: {
      matricule_snapshot: donnees.matricule_snapshot,
      nom_complet_snapshot: donnees.nom_complet_snapshot,
      fonction_snapshot: donnees.fonction_snapshot,
      salaire_base: donnees.salaire_base,
      ajustement_general: donnees.ajustement_general,
      ajustement_particulier: donnees.ajustement_particulier,
      ajustement_motif: donnees.ajustement_motif,
      net_a_payer: donnees.net_a_payer,
      montant_paye: cumulRows[0].cumul,
    },
    cycle: {
      reference: donnees.reference,
      periode_debut: donnees.periode_debut,
      periode_fin: donnees.periode_fin,
      ajustement_motif: donnees.cycle_ajustement_motif,
    },
    versements,
  });

  envoyerDocument(doc, res, nommerFichier(`recu-${donnees.numero_recu}`));
}

/* --- Liste des employes --------------------------------------------------- */

async function employes(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const d = devise(etablissement);
  const inclureInactifs = req.query.inclure_inactifs === 'true';

  const { rows } = await pool.query(
    `SELECT e.*, c.montant AS salaire, COALESCE(f.nom, c.fonction) AS fonction,
            c.date_debut AS salaire_depuis
       FROM employes e
       LEFT JOIN employes_carriere c ON c.employe_id = e.id AND c.date_fin IS NULL
       LEFT JOIN fonctions f ON f.id = c.fonction_id
      ${inclureInactifs ? '' : 'WHERE e.actif = true'}
      ORDER BY e.actif DESC, e.nom, e.prenom`
  );

  const doc = new DocumentRapport({
    etablissement,
    titre: 'Registre du personnel',
    sousTitre: inclureInactifs
      ? "Employes en poste et archives, avec leur remuneration en cours"
      : 'Employes en poste, avec leur remuneration en cours',
    auteur,
  });

  const actifs = rows.filter((r) => r.actif);
  const masse = actifs.reduce((s, r) => s + Number(r.salaire || 0), 0);

  doc.chiffresCles([
    { libelle: 'Effectif en poste', valeur: formatNombre(actifs.length) },
    { libelle: 'Masse salariale mensuelle', valeur: formatMontant(masse, d) },
    {
      libelle: 'Salaire moyen',
      valeur: formatMontant(actifs.length ? masse / actifs.length : 0, d),
    },
  ]);

  doc.titreSection('Liste nominative');
  doc.tableau({
    colonnes: [
      { titre: 'Matricule', cle: 'matricule', largeur: 1.1, uneLigne: true },
      { titre: 'Nom et prenom', cle: 'nom_complet', largeur: 3, format: (_, l) => `${l.nom} ${l.prenom}` },
      { titre: 'Fonction', cle: 'fonction', largeur: 2.2, videPar: 'Non definie' },
      { titre: 'Telephone', cle: 'telephone', largeur: 1.8, uneLigne: true, videPar: '-' },
      { titre: 'Embauche', cle: 'date_embauche', largeur: 1.3, format: formatDateCourte, uneLigne: true },
      { titre: 'Salaire', cle: 'salaire', largeur: 1.6, alignement: 'right', format: (v) => formatMontant(v, d), gras: true, uneLigne: true },
      ...(inclureInactifs
        ? [{ titre: 'Statut', cle: 'actif', largeur: 1, format: (v) => (v ? 'En poste' : 'Archive'), uneLigne: true }]
        : []),
    ],
    lignes: rows,
    total: {
      matricule: '', nom_complet: `TOTAL — ${actifs.length} employe(s) en poste`,
      fonction: '', telephone: '', date_embauche: '', salaire: masse, actif: '',
    },
    vide: 'Aucun employe enregistre.',
  });

  doc.envoyer(res, nommerFichier('registre-personnel'));
}

/* --- Statistiques de paie ------------------------------------------------- */

async function statistiquesPaie(req, res) {
  const { etablissement, auteur } = await contexteDocument(req);
  const d = devise(etablissement);

  const { from, to, employe_id } = req.query;
  const conditions = [];
  const params = [];
  if (from) { params.push(from); conditions.push(`v.paye_le >= $${params.length}`); }
  if (to) { params.push(`${to}T23:59:59.999`); conditions.push(`v.paye_le <= $${params.length}`); }
  if (employe_id) { params.push(employe_id); conditions.push(`l.employe_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [{ rows: globalRows }, { rows: parEmploye }, { rows: parMois }] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(v.montant), 0) AS total,
              count(*)::int AS versements,
              count(DISTINCT l.employe_id)::int AS employes
         FROM paie_versements v JOIN paie_lignes l ON l.id = v.ligne_id ${where}`,
      params
    ),
    pool.query(
      `SELECT l.matricule_snapshot AS matricule,
              max(l.nom_complet_snapshot) AS nom_complet,
              max(l.fonction_snapshot) AS fonction,
              COALESCE(SUM(v.montant), 0) AS total,
              count(*)::int AS versements,
              max(v.paye_le) AS dernier
         FROM paie_versements v JOIN paie_lignes l ON l.id = v.ligne_id ${where}
        GROUP BY l.matricule_snapshot ORDER BY total DESC`,
      params
    ),
    pool.query(
      `SELECT to_char(date_trunc('month', v.paye_le), 'MM/YYYY') AS mois,
              COALESCE(SUM(v.montant), 0) AS total,
              count(*)::int AS versements
         FROM paie_versements v JOIN paie_lignes l ON l.id = v.ligne_id ${where}
        GROUP BY date_trunc('month', v.paye_le) ORDER BY date_trunc('month', v.paye_le)`,
      params
    ),
  ]);

  const global = globalRows[0];

  const doc = new DocumentRapport({
    etablissement,
    titre: 'Statistiques de paie',
    sousTitre: 'Sommes reellement versees au personnel sur la periode',
    periode: libellePeriode(from, to),
    auteur,
  });

  doc.chiffresCles([
    { libelle: 'Total verse', valeur: formatMontant(global.total, d), note: `${global.versements} versement(s)` },
    { libelle: 'Employes payes', valeur: formatNombre(global.employes) },
    {
      libelle: 'Versement moyen',
      valeur: formatMontant(global.versements ? Number(global.total) / global.versements : 0, d),
    },
  ]);

  if (parMois.length > 1) {
    doc.titreSection('Repartition par mois');
    doc.tableau({
      colonnes: [
        { titre: 'Mois', cle: 'mois', largeur: 2, uneLigne: true },
        { titre: 'Versements', cle: 'versements', largeur: 1.5, alignement: 'right', format: formatNombre },
        { titre: 'Montant', cle: 'total', largeur: 2.5, alignement: 'right', format: (v) => formatMontant(v, d), gras: true },
      ],
      lignes: parMois,
    });
  }

  doc.titreSection('Detail par employe');
  doc.tableau({
    colonnes: [
      { titre: 'Matricule', cle: 'matricule', largeur: 1.1, uneLigne: true },
      { titre: 'Nom et prenom', cle: 'nom_complet', largeur: 3 },
      { titre: 'Fonction', cle: 'fonction', largeur: 2, videPar: '-' },
      { titre: 'Versements', cle: 'versements', largeur: 1.2, alignement: 'right', format: formatNombre, uneLigne: true },
      { titre: 'Dernier paiement', cle: 'dernier', largeur: 1.8, format: formatDateHeure, uneLigne: true },
      { titre: 'Total verse', cle: 'total', largeur: 1.8, alignement: 'right', format: (v) => formatMontant(v, d), gras: true, uneLigne: true },
    ],
    lignes: parEmploye,
    total: {
      matricule: '', nom_complet: 'TOTAL', fonction: '',
      versements: global.versements, dernier: '', total: global.total,
    },
    vide: 'Aucun versement sur cette periode.',
  });

  doc.envoyer(res, nommerFichier('statistiques-paie'));
}

/* --- Verification par scan ------------------------------------------------ */

/**
 * Verifie un code scanne et renvoie ce qu'il designe.
 *
 * La signature seule prouve que le code sort bien du systeme. On va plus loin
 * en verifiant que le document existe TOUJOURS : un badge signe reste
 * mathematiquement valide meme apres le depart de l'employe, ce qui serait
 * trompeur pour qui controle une entree.
 */
async function verifier(req, res) {
  const resultat = verifierJeton(req.body?.code);
  if (!resultat.valide) {
    return res.json({ valide: false, raison: resultat.raison });
  }

  if (resultat.type === 'BADGE') {
    const { rows } = await pool.query(
      `SELECT e.matricule, e.prenom, e.nom, e.photo, e.actif, e.date_embauche,
              COALESCE(f.nom, c.fonction) AS fonction
         FROM employes e
         LEFT JOIN employes_carriere c ON c.employe_id = e.id AND c.date_fin IS NULL
         LEFT JOIN fonctions f ON f.id = c.fonction_id
        WHERE e.matricule = $1`,
      [resultat.identifiant]
    );
    const employe = rows[0];
    if (!employe) {
      return res.json({
        valide: false,
        type: 'BADGE',
        raison: "Signature correcte, mais cet employe n'existe plus dans le systeme",
      });
    }
    return res.json({
      valide: true,
      type: 'BADGE',
      avertissement: employe.actif ? null : 'Cet employe est archive : le badge ne devrait plus circuler',
      donnees: employe,
    });
  }

  const { rows } = await pool.query(
    `SELECT v.numero_recu, v.montant, v.paye_le, v.mode_paiement, v.est_solde,
            l.matricule_snapshot, l.nom_complet_snapshot, l.fonction_snapshot, l.net_a_payer,
            c.reference, c.periode_debut, c.periode_fin
       FROM paie_versements v
       JOIN paie_lignes l ON l.id = v.ligne_id
       JOIN paie_cycles c ON c.id = l.cycle_id
      WHERE v.numero_recu = $1`,
    [resultat.identifiant]
  );
  const recuTrouve = rows[0];
  if (!recuTrouve) {
    return res.json({
      valide: false,
      type: 'RECU',
      raison: 'Signature correcte, mais ce recu est introuvable dans le systeme',
    });
  }
  return res.json({ valide: true, type: 'RECU', donnees: recuTrouve });
}

module.exports = { badges, recu, employes, statistiquesPaie, verifier };
