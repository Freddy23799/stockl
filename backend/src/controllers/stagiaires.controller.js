const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const config = require('../config');
const { logAudit } = require('../db/audit');
const { creerPlancheBadges } = require('../services/badge.service');
const { creerAttestationStage, nomFichierAttestation } = require('../services/attestation.service');
const { nommerFichier } = require('../services/pdf.service');

// -----------------------------------------------------------------------------
// Badge et attestation de stage d'un employe (typiquement un stagiaire, mais
// rien n'empeche de generer un badge pour n'importe quel employe actif - la
// fonction "Stagiaire" est une simple valeur de la table `fonctions`, pas un
// statut a part dans le schema).
//
// Chaque emission est journalisee dans `stagiaires_documents` : le badge n'y
// garde qu'une trace (le PDF lui-meme reste genere a la demande, comme pour
// /exports/badges.pdf), l'attestation y garde en plus son PDF et son numero,
// pour pouvoir etre retelechargee a l'identique.
// -----------------------------------------------------------------------------

async function contexteDocument(req) {
  const [{ rows: parametresRows }, { rows: auteurRows }] = await Promise.all([
    pool.query('SELECT * FROM parametres WHERE id = 1'),
    pool.query('SELECT prenom, nom, nom_utilisateur FROM utilisateurs WHERE id = $1', [req.user.id]),
  ]);
  const auteur = auteurRows[0];
  return {
    etablissement: parametresRows[0] || {},
    auteurNom: auteur
      ? [auteur.prenom, auteur.nom].filter(Boolean).join(' ') || auteur.nom_utilisateur
      : '',
  };
}

// `f.nom` d'abord, `c.fonction` en repli : un document genere aujourd'hui doit
// porter le titre en vigueur aujourd'hui (meme logique que /exports/badges.pdf).
async function chargerEmploye(employeId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.matricule, e.prenom, e.nom, e.photo, e.date_embauche, e.telephone, e.actif,
            COALESCE(f.nom, c.fonction) AS fonction
       FROM employes e
       LEFT JOIN employes_carriere c ON c.employe_id = e.id AND c.date_fin IS NULL
       LEFT JOIN fonctions f ON f.id = c.fonction_id
      WHERE e.id = $1`,
    [employeId]
  );
  return rows[0] || null;
}

function envoyerBuffer(res, buffer, nomFichier) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${nomFichier}"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}

/* --- Badge ------------------------------------------------------------------ */

async function genererBadge(req, res) {
  const employe = await chargerEmploye(req.params.id);
  if (!employe) return res.status(404).json({ message: 'Employe introuvable' });
  if (!employe.actif) {
    return res.status(400).json({ message: 'Cet employe est archive : son badge ne peut plus etre genere' });
  }

  const { etablissement } = await contexteDocument(req);
  const doc = await creerPlancheBadges([employe], etablissement);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO stagiaires_documents (employe_id, type, auteur_id) VALUES ($1, 'badge', $2)`,
      [employe.id, req.user.id]
    );
    await logAudit(client, {
      typeOperation: 'stagiaire_badge_genere',
      entiteId: employe.id,
      utilisateurId: req.user.id,
      details: { matricule: employe.matricule, nom: `${employe.prenom} ${employe.nom}` },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const morceaux = [];
  doc.on('data', (m) => morceaux.push(m));
  doc.on('end', () => envoyerBuffer(res, Buffer.concat(morceaux), nommerFichier(`badge-${employe.matricule}`)));
  doc.end();
}

/* --- Attestation -------------------------------------------------------------- */

// Numerotation sequentielle par annee : ATT-2026-0001, ATT-2026-0002...
// Contrairement au code vendeuse (aleatoire, permanent), un numero d'attestation
// doit rester lisible et ordonne - c'est un document officiel qu'on classe.
async function genererNumeroAttestation(client) {
  const annee = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT numero FROM stagiaires_documents
      WHERE type = 'attestation' AND numero LIKE $1
      ORDER BY numero DESC LIMIT 1`,
    [`ATT-${annee}-%`]
  );
  const dernier = rows[0]?.numero;
  const prochain = dernier ? Number(dernier.split('-')[2]) + 1 : 1;
  return `ATT-${annee}-${String(prochain).padStart(4, '0')}`;
}

async function genererAttestation(req, res) {
  const { date_debut_stage, date_fin_stage, maitre_stage, theme_stage, mention } = req.body;
  if (!date_debut_stage || !date_fin_stage) {
    return res.status(400).json({ message: 'Les dates de debut et de fin de stage sont requises' });
  }
  if (new Date(date_fin_stage) < new Date(date_debut_stage)) {
    return res.status(400).json({ message: 'La date de fin ne peut pas preceder la date de debut' });
  }

  const employe = await chargerEmploye(req.params.id);
  if (!employe) return res.status(404).json({ message: 'Employe introuvable' });

  const { etablissement, auteurNom } = await contexteDocument(req);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const numero = await genererNumeroAttestation(client);

    const document = {
      numero,
      date_debut_stage,
      date_fin_stage,
      maitre_stage: maitre_stage || null,
      theme_stage: theme_stage || null,
      mention: mention || null,
    };
    const buffer = await creerAttestationStage({ etablissement, employe, document, auteurNom });

    // Le PDF est ecrit sur disque APRES sa composition complete (donc apres
    // toute erreur possible de generation), mais AVANT le COMMIT : si l'ecriture
    // echoue, la transaction est annulee et aucune ligne orpheline ne reste.
    const dossier = path.join(config.uploadsDir, 'attestations');
    fs.mkdirSync(dossier, { recursive: true });
    const cheminRelatif = `uploads/attestations/${numero}.pdf`;
    fs.writeFileSync(path.join(dossier, `${numero}.pdf`), buffer);

    await client.query(
      `INSERT INTO stagiaires_documents
         (employe_id, type, numero, date_debut_stage, date_fin_stage, maitre_stage, theme_stage, mention, fichier_path, auteur_id)
       VALUES ($1, 'attestation', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [employe.id, numero, date_debut_stage, date_fin_stage, maitre_stage || null, theme_stage || null,
        mention || null, cheminRelatif, req.user.id]
    );

    await logAudit(client, {
      typeOperation: 'stagiaire_attestation_generee',
      entiteId: employe.id,
      utilisateurId: req.user.id,
      details: { matricule: employe.matricule, numero, date_debut_stage, date_fin_stage },
    });

    await client.query('COMMIT');
    envoyerBuffer(res, buffer, nomFichierAttestation(employe, new Date()));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Numero d\'attestation deja attribue, reessayez' });
    }
    throw err;
  } finally {
    client.release();
  }
}

/* --- Historique ---------------------------------------------------------- */

async function listerDocuments(req, res) {
  const { rows } = await pool.query(
    `SELECT sd.*, u.prenom AS auteur_prenom, u.nom AS auteur_nom
       FROM stagiaires_documents sd
       LEFT JOIN utilisateurs u ON u.id = sd.auteur_id
      WHERE sd.employe_id = $1
      ORDER BY sd.created_at DESC`,
    [req.params.id]
  );
  res.json(rows);
}

async function telechargerDocument(req, res) {
  const { rows } = await pool.query(
    `SELECT * FROM stagiaires_documents WHERE id = $1 AND employe_id = $2 AND type = 'attestation'`,
    [req.params.documentId, req.params.id]
  );
  const document = rows[0];
  if (!document || !document.fichier_path) {
    return res.status(404).json({ message: 'Document introuvable' });
  }
  const chemin = path.join(config.uploadsDir, document.fichier_path.replace(/^uploads\//, ''));
  if (!fs.existsSync(chemin)) return res.status(404).json({ message: 'Fichier introuvable sur le serveur' });
  res.download(chemin, `${document.numero}.pdf`);
}

module.exports = { genererBadge, genererAttestation, listerDocuments, telechargerDocument };
