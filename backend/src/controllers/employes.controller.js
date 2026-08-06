const pool = require('../config/db');
const { logAudit } = require('../db/audit');
const { genererMatriculeUnique } = require('../utils/identifiants-rh');
const path = require('path');
const config = require('../config');
const { finaliserFichier, nettoyerAnciennesVersions } = require('../middleware/upload.middleware');
const { traiterImage } = require('../services/images.pool');
const { COTE_MAX_PHOTO } = require('../services/images.service');
const {
  carriereCourante, historiqueCarriere, ajouterPeriode, corrigerPeriode,
  PeriodeFermeeError, DateCarriereError,
} = require('../services/employes.service');

// Champs de la fiche modifiables depuis l'interface. Liste blanche : elle sert
// a la fois a construire l'UPDATE et a interdire qu'un corps de requete vienne
// ecrire `matricule` ou `created_at`, qui n'appartiennent pas a l'utilisateur.
const CHAMPS_MODIFIABLES = [
  'prenom', 'nom', 'sexe', 'date_naissance', 'lieu_naissance', 'nationalite',
  'situation_matrimoniale', 'nombre_enfants',
  'telephone', 'telephone_2', 'email', 'adresse', 'quartier', 'ville',
  'numero_cni', 'cni_date_delivrance', 'cni_lieu_delivrance', 'cni_date_expiration',
  'urgence_nom', 'urgence_telephone', 'urgence_lien',
  'date_embauche', 'date_sortie', 'motif_sortie', 'type_contrat',
  'numero_securite_sociale', 'banque_nom', 'banque_numero_compte', 'note',
];

// Les colonnes DATE refusent une chaine vide ; le formulaire, lui, envoie ""
// pour un champ laisse blanc. Sans cette conversion, effacer une date renvoie
// une erreur PostgreSQL 22007 incomprehensible.
const CHAMPS_DATE = new Set([
  'date_naissance', 'cni_date_delivrance', 'cni_date_expiration',
  'date_embauche', 'date_sortie',
]);

function normaliser(colonne, valeur) {
  if (valeur === undefined) return undefined;
  if (valeur === null) return null;
  if (typeof valeur === 'string') {
    const texte = valeur.trim();
    if (texte === '') return null;
    return texte;
  }
  if (CHAMPS_DATE.has(colonne) && valeur === '') return null;
  return valeur;
}

/* --- Lecture -------------------------------------------------------------- */

async function list(req, res) {
  const { recherche, inclure_inactifs, fonction_id: fonctionId } = req.query;
  const conditions = [];
  const params = [];

  if (inclure_inactifs !== 'true') conditions.push('e.actif = true');

  if (recherche) {
    params.push(`%${String(recherche).trim()}%`);
    // La recherche porte sur ce dont on dispose quand on cherche quelqu'un :
    // son nom, son matricule lu sur un badge, son telephone, ou sa fonction.
    conditions.push(
      `(e.prenom ILIKE $${params.length} OR e.nom ILIKE $${params.length}
        OR e.matricule ILIKE $${params.length} OR e.telephone ILIKE $${params.length}
        OR c.fonction ILIKE $${params.length})`
    );
  }
  if (fonctionId) {
    params.push(fonctionId);
    conditions.push(`c.fonction_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // La carriere en cours est jointe ici plutot que demandee ligne par ligne :
  // une liste de deux cents employes ne doit pas declencher deux cents requetes.
  const { rows } = await pool.query(
    // Vue de l'etat courant : le titre affiche suit le renommage d'une fonction.
    // Les historiques (carriere, bulletins) gardent le libelle d'epoque.
    `SELECT e.*, c.montant AS salaire_actuel, COALESCE(f.nom, c.fonction) AS fonction,
            c.date_debut AS salaire_depuis, c.fonction_id,
            (SELECT count(*)::int FROM employes_documents d WHERE d.employe_id = e.id) AS nombre_documents,
            v.id AS vendeuse_id, v.code AS vendeuse_code
       FROM employes e
       LEFT JOIN employes_carriere c ON c.employe_id = e.id AND c.date_fin IS NULL
       LEFT JOIN fonctions f ON f.id = c.fonction_id
       LEFT JOIN vendeuses v ON v.employe_id = e.id
       ${where}
       ORDER BY e.actif DESC, e.nom, e.prenom`,
    params
  );
  res.json(rows);
}

async function getById(req, res) {
  const { rows } = await pool.query(
    `SELECT e.*, c.montant AS salaire_actuel, COALESCE(f.nom, c.fonction) AS fonction,
            c.fonction_id, c.date_debut AS salaire_depuis,
            v.id AS vendeuse_id, v.code AS vendeuse_code, v.actif AS vendeuse_active
       FROM employes e
       LEFT JOIN employes_carriere c ON c.employe_id = e.id AND c.date_fin IS NULL
       LEFT JOIN fonctions f ON f.id = c.fonction_id
       LEFT JOIN vendeuses v ON v.employe_id = e.id
      WHERE e.id = $1`,
    [req.params.id]
  );
  const employe = rows[0];
  if (!employe) return res.status(404).json({ message: 'Employe introuvable' });

  const client = await pool.connect();
  try {
    const carriere = await historiqueCarriere(client, employe.id);
    const { rows: documents } = await client.query(
      `SELECT d.*,
              COALESCE(json_agg(json_build_object(
                'id', f.id, 'chemin', f.chemin, 'nom_original', f.nom_original,
                'type_mime', f.type_mime, 'taille_octets', f.taille_octets,
                'taille_origine', f.taille_origine
              ) ORDER BY f.ordre, f.id) FILTER (WHERE f.id IS NOT NULL), '[]') AS fichiers
         FROM employes_documents d
         LEFT JOIN employes_documents_fichiers f ON f.document_id = d.id
        WHERE d.employe_id = $1
        GROUP BY d.id
        ORDER BY d.created_at DESC`,
      [employe.id]
    );
    res.json({ ...employe, carriere, documents });
  } finally {
    client.release();
  }
}

/* --- Ecriture ------------------------------------------------------------- */

async function create(req, res) {
  const { prenom, nom, salaire, fonction_id: fonctionId } = req.body;
  if (!prenom?.trim() || !nom?.trim()) {
    return res.status(400).json({ message: 'Le prenom et le nom sont requis' });
  }
  // La fonction vient de la table de reference : accepter du texte libre
  // recreerait les doublons que cette table existe pour empecher.
  if (!fonctionId) {
    return res.status(400).json({ message: 'Choisissez une fonction dans la liste' });
  }
  if (salaire === undefined || salaire === null || Number(salaire) < 0) {
    return res.status(400).json({ message: 'Le salaire est requis et doit etre positif ou nul' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const matricule = await genererMatriculeUnique(client);

    const colonnes = ['matricule'];
    const valeurs = [matricule];
    for (const champ of CHAMPS_MODIFIABLES) {
      const valeur = normaliser(champ, req.body[champ]);
      if (valeur !== undefined) { colonnes.push(champ); valeurs.push(valeur); }
    }

    const positions = valeurs.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(
      `INSERT INTO employes (${colonnes.join(', ')}) VALUES (${positions}) RETURNING *`,
      valeurs
    );
    const employe = rows[0];

    // La premiere periode de carriere demarre a l'embauche, pas aujourd'hui :
    // un employe saisi avec trois mois de retard doit avoir un historique juste.
    await ajouterPeriode(client, {
      employeId: employe.id,
      montant: salaire,
      fonctionId,
      // `date_embauche` est deja une chaine 'AAAA-MM-JJ' : les colonnes DATE ne
      // passent plus par un objet Date, qui decalait le jour (voir config/db.js).
      dateDebut: employe.date_embauche,
      motif: 'Embauche',
      auteurId: req.user.id,
    });

    await logAudit(client, {
      typeOperation: 'employe_creation',
      entiteId: employe.id,
      utilisateurId: req.user.id,
      details: { matricule, nom_complet: `${employe.prenom} ${employe.nom}` },
      apres: { matricule, prenom: employe.prenom, nom: employe.nom, salaire },
    });

    await client.query('COMMIT');
    res.status(201).json(employe);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const colonnes = [];
  const valeurs = [];
  for (const champ of CHAMPS_MODIFIABLES) {
    const valeur = normaliser(champ, req.body[champ]);
    if (valeur !== undefined) { colonnes.push(champ); valeurs.push(valeur); }
  }
  if (!colonnes.length) {
    return res.status(400).json({ message: 'Aucune information a modifier' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: avantRows } = await client.query('SELECT * FROM employes WHERE id = $1', [req.params.id]);
    const avant = avantRows[0];
    if (!avant) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Employe introuvable' });
    }

    // Les noms de colonnes viennent de la liste blanche, jamais du corps de la
    // requete : la construction dynamique ne peut pas etre detournee.
    const affectations = colonnes.map((c, i) => `${c} = $${i + 1}`).join(', ');
    valeurs.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE employes SET ${affectations}, updated_at = now() WHERE id = $${valeurs.length} RETURNING *`,
      valeurs
    );
    const apres = rows[0];

    const modifies = colonnes.filter((c) => String(avant[c] ?? '') !== String(apres[c] ?? ''));
    if (modifies.length) {
      const extraire = (source) => Object.fromEntries(modifies.map((c) => [c, source[c]]));
      await logAudit(client, {
        typeOperation: 'employe_modification',
        entiteId: apres.id,
        utilisateurId: req.user.id,
        details: { matricule: apres.matricule, nom_complet: `${apres.prenom} ${apres.nom}` },
        avant: extraire(avant),
        apres: extraire(apres),
      });
    }

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
 * Archive ou reactive un employe.
 *
 * Jamais de suppression : un employe parti reste rattache a ses bulletins de
 * paie, et une cle etrangere le protege de toute facon. L'archivage le retire
 * des listes et des futurs cycles de paie sans toucher a son passe.
 */
function setActif(actif) {
  return async (req, res) => {
    const motif = String(req.body?.motif || '').trim();

    // Le motif est exige au blocage, jamais au deblocage. Sans lui, personne ne
    // saura six mois plus tard s'il s'agissait d'un depart, d'une suspension ou
    // d'un conge - donc si la fiche doit etre rouverte.
    if (!actif && !motif) {
      return res.status(400).json({
        message: 'Indiquez le motif du blocage.',
        code: 'MOTIF_REQUIS',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE employes
            SET actif = $1,
                motif_blocage = $2,
                bloque_le = CASE WHEN $1 THEN NULL ELSE now() END,
                bloque_par = CASE WHEN $1 THEN NULL ELSE $3::int END,
                updated_at = now()
          WHERE id = $4 RETURNING *`,
        [actif, actif ? null : motif, actif ? null : req.user.id, req.params.id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Employe introuvable' });
      }

      // Un employe archive ne doit plus pouvoir encaisser : son code vendeuse
      // est desactive en meme temps, sinon il resterait accepte a la caisse.
      if (!actif) {
        await client.query('UPDATE vendeuses SET actif = false WHERE employe_id = $1', [req.params.id]);
      }

      await logAudit(client, {
        typeOperation: actif ? 'employe_reactivation' : 'employe_blocage',
        entiteId: Number(req.params.id),
        utilisateurId: req.user.id,
        details: {
          matricule: rows[0].matricule,
          nom_complet: `${rows[0].prenom} ${rows[0].nom}`,
          motif: motif || null,
        },
        avant: { actif: !actif },
        apres: { actif, motif_blocage: actif ? null : motif },
      });

      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
}

/* --- Carriere ------------------------------------------------------------- */

async function ajouterCarriere(req, res) {
  const { montant, fonction_id: fonctionId, date_debut, motif } = req.body;
  if (montant === undefined || Number(montant) < 0) {
    return res.status(400).json({ message: 'Le montant est requis et doit etre positif ou nul' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const periode = await ajouterPeriode(client, {
      employeId: Number(req.params.id),
      montant,
      fonctionId,
      dateDebut: date_debut,
      motif,
      auteurId: req.user.id,
    });
    await client.query('COMMIT');
    res.status(201).json(periode);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof DateCarriereError) {
      return res.status(400).json({ message: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function corrigerCarriere(req, res) {
  const { montant, fonction_id: fonctionId, motif } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const periode = await corrigerPeriode(client, {
      periodeId: Number(req.params.periodeId),
      montant,
      fonctionId,
      motif,
      auteurId: req.user.id,
    });
    if (!periode) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Periode introuvable' });
    }
    await client.query('COMMIT');
    res.json(periode);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof PeriodeFermeeError) {
      return res.status(409).json({ message: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }
}

/* --- Photo ---------------------------------------------------------------- */

async function uploadPhoto(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier recu' });

  const { rows: existants } = await pool.query('SELECT id FROM employes WHERE id = $1', [req.params.id]);
  if (!existants.length) {
    // Le fichier temporaire est abandonne : `finaliserFichier` n'a pas ete
    // appele, donc rien n'a ete renomme dans le dossier definitif.
    return res.status(404).json({ message: 'Employe introuvable' });
  }

  const cheminBrut = finaliserFichier(req.file, 'employes', `employe-${req.params.id}`);

  // La reduction part dans un fil separe : une photo prise au telephone pese
  // plusieurs mega-octets et son traitement figerait le serveur pour tout le
  // monde pendant une demi-seconde.
  const bilan = await traiterImage({
    chemin: path.join(config.uploadsDir, cheminBrut.replace(/^uploads\//, '')),
    coteMax: COTE_MAX_PHOTO,
  });
  const chemin = `uploads/employes/${path.basename(bilan.chemin)}`;
  nettoyerAnciennesVersions('employes', `employe-${req.params.id}`, chemin);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE employes SET photo = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [chemin, req.params.id]
    );
    await logAudit(client, {
      typeOperation: 'employe_photo_modifiee',
      entiteId: Number(req.params.id),
      utilisateurId: req.user.id,
      details: { matricule: rows[0].matricule },
    });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  list, getById, create, update,
  archiver: setActif(false), reactiver: setActif(true),
  ajouterCarriere, corrigerCarriere, uploadPhoto,
  CHAMPS_MODIFIABLES,
};
