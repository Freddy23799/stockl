const fs = require('fs');
const pool = require('../config/db');
const { logAudit } = require('../db/audit');
const { finaliserFichier, nettoyerAnciennesVersions } = require('../middleware/upload.middleware');

// Le rayon et la marque accompagnent toujours la fiche : l'ecran de vente les
// affiche sur chaque carte, et les filtres s'en servent sans avoir a charger
// deux listes de reference pour reconstituer un libelle.
const SELECT_PRODUIT = `
  SELECT p.*, c.nom AS categorie, m.nom AS marque
    FROM produits p
    LEFT JOIN categories c ON c.id = p.categorie_id
    LEFT JOIN marques    m ON m.id = p.marque_id`;

async function list(req, res) {
  const includeInactifs = req.query.includeInactifs === 'true';
  const conditions = [];
  const params = [];

  if (!includeInactifs) conditions.push('p.actif = true');
  if (req.query.categorie_id) {
    params.push(req.query.categorie_id);
    conditions.push(`p.categorie_id = $${params.length}`);
  }
  if (req.query.marque_id) {
    params.push(req.query.marque_id);
    conditions.push(`p.marque_id = $${params.length}`);
  }
  // La recherche porte aussi sur le rayon et la marque : on cherche autant
  // "riz" que "Bijou", et l'un comme l'autre doit ramener la meme etagere.
  if (req.query.recherche) {
    params.push(`%${String(req.query.recherche).trim()}%`);
    const i = params.length;
    conditions.push(`(p.nom ILIKE $${i} OR c.nom ILIKE $${i} OR m.nom ILIKE $${i})`);
  }

  const { rows } = await pool.query(
    `${SELECT_PRODUIT} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY p.nom`,
    params
  );
  res.json(rows);
}

async function getById(req, res) {
  const { rows } = await pool.query(`${SELECT_PRODUIT} WHERE p.id = $1`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ message: 'Produit introuvable' });
  res.json(rows[0]);
}

// Champs de la fiche produit retenus pour le journal d'audit. Liste blanche :
// une fiche complete transporte aussi un chemin de photo et des horodatages
// techniques, qui n'apprennent rien a qui relit l'operation.
const CHAMPS_AUDIT_PRODUIT = [
  'nom', 'categorie', 'marque', 'prix_vente', 'unite_stock', 'unite_achat',
  'facteur_conversion', 'seuil_alerte', 'quantite_stock', 'cout_moyen_pondere', 'actif',
];

function etatProduitPourAudit(produit) {
  if (!produit) return null;
  const etat = {};
  for (const champ of CHAMPS_AUDIT_PRODUIT) etat[champ] = produit[champ];
  return etat;
}

// 1 unite d'achat = facteur_conversion unites de stock. entreeStock divise par
// cette valeur : a zero ou negative, le calcul du cout unitaire n'a plus de sens.
function validerFacteurConversion(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre) || nombre <= 0) {
    return 'facteur_conversion doit etre un nombre strictement positif';
  }
  return null;
}

// Une reference vide arrive du formulaire sous plusieurs formes selon le
// navigateur et le composant : chaine vide, "null", ou rien du tout. Toutes
// veulent dire "non classe", et doivent devenir NULL et non NaN.
function referenceOuNull(valeur) {
  if (valeur === undefined || valeur === null || valeur === '' || valeur === 'null') return null;
  const nombre = Number(valeur);
  return Number.isInteger(nombre) && nombre > 0 ? nombre : null;
}

async function create(req, res) {
  const { nom, prix_vente, unite_stock, unite_achat, facteur_conversion, seuil_alerte } = req.body;
  if (!nom || prix_vente === undefined || !unite_stock) {
    return res.status(400).json({ message: 'nom, prix_vente et unite_stock sont requis' });
  }
  const erreurConversion = validerFacteurConversion(facteur_conversion);
  if (erreurConversion) return res.status(400).json({ message: erreurConversion });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: creees } = await client.query(
      `INSERT INTO produits (nom, prix_vente, unite_stock, unite_achat, facteur_conversion,
                             seuil_alerte, categorie_id, marque_id)
       VALUES ($1, $2, $3, $4, COALESCE($5, 1), COALESCE($6, 0), $7, $8)
       RETURNING id`,
      [nom, prix_vente, unite_stock, unite_achat || null, facteur_conversion, seuil_alerte,
        referenceOuNull(req.body.categorie_id), referenceOuNull(req.body.marque_id)]
    );
    // Relecture jointe : le journal d'audit et la reponse doivent porter les
    // libelles du rayon et de la marque, pas leurs identifiants - une ligne
    // d'historique disant « categorie : 7 » n'apprend rien a personne.
    const { rows } = await client.query(`${SELECT_PRODUIT} WHERE p.id = $1`, [creees[0].id]);
    const produit = rows[0];
    await logAudit(client, {
      typeOperation: 'produit_creation',
      entiteId: produit.id,
      utilisateurId: req.user?.id,
      details: { produit_nom: produit.nom },
      apres: etatProduitPourAudit(produit),
    });
    await client.query('COMMIT');
    res.status(201).json(produit);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const { id } = req.params;
  const { nom, prix_vente, unite_stock, unite_achat, facteur_conversion, seuil_alerte } = req.body;

  const erreurConversion = validerFacteurConversion(facteur_conversion);
  if (erreurConversion) return res.status(400).json({ message: erreurConversion });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      `${SELECT_PRODUIT} WHERE p.id = $1 FOR UPDATE OF p`, [id]
    );
    if (existingRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Produit introuvable' });
    }
    const existing = existingRows[0];

    const nouveauPrix = prix_vente !== undefined ? prix_vente : existing.prix_vente;

    // Rayon et marque se distinguent des autres champs : ils doivent pouvoir
    // etre RETIRES. Un COALESCE les rendrait indelebiles une fois poses, alors
    // que « ce produit n'appartient finalement a aucun rayon » est une
    // correction legitime. D'ou le test sur la presence de la cle dans le
    // corps, et non sur la valeur.
    const categorieFournie = req.body.categorie_id !== undefined;
    const marqueFournie = req.body.marque_id !== undefined;

    await client.query(
      `UPDATE produits SET
         nom = COALESCE($1, nom),
         prix_vente = $2,
         unite_stock = COALESCE($3, unite_stock),
         unite_achat = COALESCE($4, unite_achat),
         facteur_conversion = COALESCE($5, facteur_conversion),
         seuil_alerte = COALESCE($6, seuil_alerte),
         categorie_id = CASE WHEN $8 THEN $9::int ELSE categorie_id END,
         marque_id    = CASE WHEN $10 THEN $11::int ELSE marque_id END,
         updated_at = now()
       WHERE id = $7`,
      [nom, nouveauPrix, unite_stock, unite_achat, facteur_conversion, seuil_alerte, id,
        categorieFournie, referenceOuNull(req.body.categorie_id),
        marqueFournie, referenceOuNull(req.body.marque_id)]
    );
    const { rows } = await client.query(`${SELECT_PRODUIT} WHERE p.id = $1`, [id]);
    const produit = rows[0];

    // Regle stricte : tout changement de prix de vente est trace dans l'Historique.
    // Les ventes deja enregistrees restent figees et ne sont jamais recalculees.
    if (prix_vente !== undefined && Number(prix_vente) !== Number(existing.prix_vente)) {
      await client.query(
        `INSERT INTO historique_prix (produit_id, ancien_prix, nouveau_prix, auteur_id)
         VALUES ($1, $2, $3, $4)`,
        [id, existing.prix_vente, prix_vente, req.user?.id]
      );
      await logAudit(client, {
        typeOperation: 'produit_changement_prix',
        entiteId: Number(id),
        utilisateurId: req.user?.id,
        // Le nom est fige ici : la fiche peut etre renommee ou archivee plus
        // tard, la ligne d'audit doit rester lisible telle quelle.
        details: { produit_nom: produit.nom },
        avant: { prix_vente: existing.prix_vente },
        apres: { prix_vente: produit.prix_vente },
      });
    }

    await logAudit(client, {
      typeOperation: 'produit_modification',
      entiteId: Number(id),
      utilisateurId: req.user?.id,
      details: { produit_nom: produit.nom },
      avant: etatProduitPourAudit(existing),
      apres: etatProduitPourAudit(produit),
    });

    await client.query('COMMIT');
    res.json(produit);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function desactiver(req, res) {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Etat lu avant l'archivage, dans la meme transaction : c'est la derniere
    // occasion de capturer le stock et le prix que le produit avait encore.
    const { rows: existingRows } = await client.query('SELECT * FROM produits WHERE id = $1 FOR UPDATE', [id]);
    if (existingRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Produit introuvable' });
    }
    const existing = existingRows[0];

    const { rows } = await client.query(
      'UPDATE produits SET actif = false, updated_at = now() WHERE id = $1 RETURNING *',
      [id]
    );
    await logAudit(client, {
      typeOperation: 'produit_desactivation',
      entiteId: Number(id),
      utilisateurId: req.user?.id,
      details: { produit_nom: existing.nom },
      avant: etatProduitPourAudit(existing),
      apres: etatProduitPourAudit(rows[0]),
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

async function historiquePrix(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM historique_prix WHERE produit_id = $1 ORDER BY date DESC',
    [req.params.id]
  );
  res.json(rows);
}

async function uploadPhoto(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier recu' });

  const { id } = req.params;

  // On verifie que le produit existe AVANT de poser le fichier definitif :
  // sinon une photo envoyee sur un identifiant inexistant resterait sur le
  // disque sans qu'aucune fiche ne la reference.
  const { rows: existe } = await pool.query('SELECT 1 FROM produits WHERE id = $1', [id]);
  if (existe.length === 0) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ message: 'Produit introuvable' });
  }

  const relativePath = finaliserFichier(req.file, 'produits', String(id));
  nettoyerAnciennesVersions('produits', String(id), relativePath);

  const { rows } = await pool.query(
    'UPDATE produits SET photo = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [relativePath, id]
  );
  res.json(rows[0]);
}

module.exports = { list, getById, create, update, desactiver, historiquePrix, uploadPhoto };
