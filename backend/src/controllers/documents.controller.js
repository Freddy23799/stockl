const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const config = require('../config');
const { logAudit } = require('../db/audit');
const { COTE_MAX_DOCUMENT } = require('../services/images.service');
const { traiterImage } = require('../services/images.pool');

// -----------------------------------------------------------------------------
// Pieces du dossier d'un employe.
//
// Un document porte un nom ("Contrat de travail") et regroupe plusieurs
// fichiers : un contrat numerise page par page reste un seul document. C'est ce
// qui distingue ce modele d'une simple liste de fichiers en vrac.
// -----------------------------------------------------------------------------

const CATEGORIES = [
  'contrat', 'identite', 'diplome', 'certificat', 'medical', 'bancaire', 'autre',
];

/**
 * Range les fichiers recus sous le dossier du document et les reduit.
 *
 * La reduction part dans un fil d'execution separe, et les fichiers sont
 * traites EN PARALLELE. Auparavant chaque image etait redimensionnee dans le
 * fil principal, l'une apres l'autre : un contrat de dix pages figeait le
 * serveur entier pendant sept secondes, et toutes les autres requetes
 * attendaient. C'est ce qui donnait l'impression que toute l'application etait
 * lente, pas seulement l'envoi.
 */
async function rangerFichiers(fichiers, documentId) {
  const dossier = path.join(config.uploadsDir, 'documents', String(documentId));
  fs.mkdirSync(dossier, { recursive: true });

  const places = fichiers.map((fichier, index) => {
    const extension = path.extname(fichier.filename).toLowerCase();
    const nomFinal = `piece-${Date.now()}-${index}${extension}`;
    const destination = path.join(dossier, nomFinal);

    // Le fichier n'est deplace vers son emplacement definitif qu'ici, une fois
    // l'envoi complet : un transfert interrompu ne laisse jamais de fichier
    // tronque dans le dossier de l'employe.
    fs.renameSync(fichier.path, destination);
    return { fichier, destination, index };
  });

  const bilans = await Promise.all(
    places.map((p) => traiterImage({ chemin: p.destination, coteMax: COTE_MAX_DOCUMENT }))
  );

  return places.map((p, i) => ({
    chemin: `uploads/documents/${documentId}/${path.basename(bilans[i].chemin)}`,
    nomOriginal: p.fichier.originalname,
    typeMime: p.fichier.mimetype,
    tailleOctets: bilans[i].tailleFinale,
    tailleOrigine: bilans[i].tailleOrigine,
    ordre: p.index,
  }));
}

/** Supprime les fichiers deja ranges. Utilise quand la transaction echoue. */
function nettoyer(fichiersRanges) {
  for (const f of fichiersRanges) {
    try {
      fs.unlinkSync(path.join(config.uploadsDir, f.chemin.replace(/^uploads\//, '')));
    } catch {
      // Deja absent : rien a faire.
    }
  }
}

async function creer(req, res) {
  const { nom, categorie, note } = req.body;
  const fichiers = req.files || [];

  if (!nom?.trim()) {
    return res.status(400).json({ message: 'Le nom du document est requis' });
  }
  if (categorie && !CATEGORIES.includes(categorie)) {
    return res.status(400).json({
      message: `Categorie invalide. Valeurs acceptees : ${CATEGORIES.join(', ')}.`,
    });
  }

  const { rows: employes } = await pool.query('SELECT id, matricule FROM employes WHERE id = $1', [req.params.id]);
  if (!employes.length) {
    return res.status(404).json({ message: 'Employe introuvable' });
  }

  const client = await pool.connect();
  let ranges = [];
  try {
    await client.query('BEGIN');

    const { rows: docRows } = await client.query(
      `INSERT INTO employes_documents (employe_id, nom, categorie, note, auteur_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, nom.trim(), categorie || null, note || null, req.user.id]
    );
    const document = docRows[0];

    ranges = await rangerFichiers(fichiers, document.id);
    for (const f of ranges) {
      await client.query(
        `INSERT INTO employes_documents_fichiers
           (document_id, chemin, nom_original, type_mime, taille_octets, taille_origine, ordre)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [document.id, f.chemin, f.nomOriginal, f.typeMime, f.tailleOctets, f.tailleOrigine, f.ordre]
      );
    }

    await logAudit(client, {
      typeOperation: 'employe_document_ajout',
      entiteId: Number(req.params.id),
      utilisateurId: req.user.id,
      details: {
        matricule: employes[0].matricule,
        nom_document: nom.trim(),
        nombre_fichiers: ranges.length,
      },
    });

    await client.query('COMMIT');
    res.status(201).json({ ...document, fichiers: ranges });
  } catch (err) {
    await client.query('ROLLBACK');
    // La transaction a ete annulee mais les fichiers, eux, sont deja sur le
    // disque : sans ce nettoyage ils resteraient orphelins pour toujours.
    nettoyer(ranges);
    throw err;
  } finally {
    client.release();
  }
}

/** Ajoute des fichiers a un document existant. */
async function ajouterFichiers(req, res) {
  const fichiers = req.files || [];
  if (!fichiers.length) {
    return res.status(400).json({ message: 'Aucun fichier recu' });
  }

  const { rows: docs } = await pool.query(
    'SELECT * FROM employes_documents WHERE id = $1 AND employe_id = $2',
    [req.params.documentId, req.params.id]
  );
  if (!docs.length) return res.status(404).json({ message: 'Document introuvable' });

  const { rows: ordreRows } = await pool.query(
    'SELECT COALESCE(MAX(ordre), -1) + 1 AS suivant FROM employes_documents_fichiers WHERE document_id = $1',
    [req.params.documentId]
  );
  const depart = ordreRows[0].suivant;

  const client = await pool.connect();
  let ranges = [];
  try {
    await client.query('BEGIN');
    ranges = (await rangerFichiers(fichiers, docs[0].id)).map((f, i) => ({ ...f, ordre: depart + i }));
    for (const f of ranges) {
      await client.query(
        `INSERT INTO employes_documents_fichiers
           (document_id, chemin, nom_original, type_mime, taille_octets, taille_origine, ordre)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [docs[0].id, f.chemin, f.nomOriginal, f.typeMime, f.tailleOctets, f.tailleOrigine, f.ordre]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ document_id: docs[0].id, fichiers: ranges });
  } catch (err) {
    await client.query('ROLLBACK');
    nettoyer(ranges);
    throw err;
  } finally {
    client.release();
  }
}

/** Renomme un document ou change sa categorie, sans toucher a ses fichiers. */
async function modifier(req, res) {
  const { nom, categorie, note } = req.body;

  if (nom !== undefined && !String(nom).trim()) {
    return res.status(400).json({ message: 'Le nom du document ne peut pas etre vide' });
  }
  if (categorie && !CATEGORIES.includes(categorie)) {
    return res.status(400).json({
      message: `Categorie invalide. Valeurs acceptees : ${CATEGORIES.join(', ')}.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: avantRows } = await client.query(
      `SELECT d.*, e.matricule FROM employes_documents d
         JOIN employes e ON e.id = d.employe_id
        WHERE d.id = $1 AND d.employe_id = $2`,
      [req.params.documentId, req.params.id]
    );
    const avant = avantRows[0];
    if (!avant) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Document introuvable' });
    }

    const { rows } = await client.query(
      `UPDATE employes_documents
          SET nom = COALESCE($1, nom),
              categorie = COALESCE($2, categorie),
              note = CASE WHEN $3::text IS NULL THEN note ELSE NULLIF($3, '') END
        WHERE id = $4 RETURNING *`,
      [nom ? String(nom).trim() : null, categorie || null,
        note === undefined ? null : String(note), req.params.documentId]
    );
    const apres = rows[0];

    await logAudit(client, {
      typeOperation: 'employe_document_modification',
      entiteId: Number(req.params.id),
      utilisateurId: req.user.id,
      details: { matricule: avant.matricule, nom_document: apres.nom },
      avant: { nom: avant.nom, categorie: avant.categorie, note: avant.note },
      apres: { nom: apres.nom, categorie: apres.categorie, note: apres.note },
    });

    await client.query('COMMIT');
    res.json(apres);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retire une seule piece d'un document.
 *
 * Sans cela, une page numerisee a l'envers obligeait a supprimer le document
 * entier et a tout recommencer.
 */
async function supprimerFichier(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT f.*, d.nom AS document_nom, e.matricule
         FROM employes_documents_fichiers f
         JOIN employes_documents d ON d.id = f.document_id
         JOIN employes e ON e.id = d.employe_id
        WHERE f.id = $1 AND d.id = $2 AND d.employe_id = $3`,
      [req.params.fichierId, req.params.documentId, req.params.id]
    );
    const fichier = rows[0];
    if (!fichier) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Fichier introuvable' });
    }

    const { rows: restants } = await client.query(
      'SELECT count(*)::int AS n FROM employes_documents_fichiers WHERE document_id = $1',
      [req.params.documentId]
    );
    // Un document sans aucune piece n'a plus de raison d'exister : plutot que
    // de laisser une coquille vide dans le dossier, on refuse et on oriente
    // vers la suppression du document.
    if (restants[0].n <= 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: "C'est la derniere piece de ce document. Supprimez le document entier, "
          + "ou ajoutez d'abord une autre piece.",
        code: 'DERNIER_FICHIER',
      });
    }

    await client.query('DELETE FROM employes_documents_fichiers WHERE id = $1', [req.params.fichierId]);
    await logAudit(client, {
      typeOperation: 'employe_document_fichier_suppression',
      entiteId: Number(req.params.id),
      utilisateurId: req.user.id,
      details: {
        matricule: fichier.matricule,
        nom_document: fichier.document_nom,
        fichier: fichier.nom_original,
      },
    });

    await client.query('COMMIT');

    // Le fichier ne part qu'apres le COMMIT : si la transaction avait echoue,
    // la base pointerait vers un fichier deja efface.
    nettoyer([{ chemin: fichier.chemin }]);
    res.json({ message: 'Piece retiree du document' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function supprimer(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: docs } = await client.query(
      `SELECT d.*, e.matricule FROM employes_documents d
         JOIN employes e ON e.id = d.employe_id
        WHERE d.id = $1 AND d.employe_id = $2`,
      [req.params.documentId, req.params.id]
    );
    if (!docs.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Document introuvable' });
    }

    const { rows: fichiers } = await client.query(
      'SELECT chemin FROM employes_documents_fichiers WHERE document_id = $1',
      [req.params.documentId]
    );

    await client.query('DELETE FROM employes_documents WHERE id = $1', [req.params.documentId]);

    await logAudit(client, {
      typeOperation: 'employe_document_suppression',
      entiteId: Number(req.params.id),
      utilisateurId: req.user.id,
      details: {
        matricule: docs[0].matricule,
        nom_document: docs[0].nom,
        nombre_fichiers: fichiers.length,
      },
    });

    await client.query('COMMIT');

    // Les fichiers ne partent qu'apres le COMMIT : si la transaction avait
    // echoue, la base pointerait vers des fichiers deja effaces.
    nettoyer(fichiers);
    try {
      fs.rmSync(path.join(config.uploadsDir, 'documents', String(req.params.documentId)), {
        recursive: true, force: true,
      });
    } catch {
      // Dossier deja retire ou verrouille : sans consequence.
    }

    res.json({ message: 'Document supprime' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { creer, ajouterFichiers, modifier, supprimerFichier, supprimer, CATEGORIES };
