const pool = require('../config/db');
const { logAudit } = require('../db/audit');

// -----------------------------------------------------------------------------
// Fabrique de controleurs pour les tables de reference.
//
// Categories et marques de produits se gerent exactement comme les fonctions du
// personnel : une liste fermee, un nom unique quelle que soit la casse, une
// desactivation plutot qu'une suppression des que la valeur sert quelque part.
//
// Ce sont deux cents lignes identiques a la virgule pres, ou seuls changent le
// nom de la table et la requete qui compte les usages. Les recopier, c'est
// s'assurer qu'une correction apportee a l'une manquera aux autres - le genre
// d'ecart qui ne se voit qu'a l'usage, des mois plus tard.
//
// `fonctions` garde son propre controleur : son refus de suppression parle de
// bulletins de paie et de periodes de carriere, ce qui ne se generalise pas.
// -----------------------------------------------------------------------------

const VIOLATION_CLE_ETRANGERE = '23503';
const VIOLATION_UNICITE = '23505';

/**
 * @param {object} spec
 * @param {string} spec.table        nom de la table SQL
 * @param {string} spec.singulier    'categorie' - sert aux messages et a l'audit
 * @param {string} spec.article      'La' / 'Le' - accord des messages
 * @param {string} spec.usageSql     requete comptant les usages, $1 = id,
 *                                   renvoyant { total, actifs }
 * @param {function} spec.messageUsage (nom, usage) => string
 */
function creerReferentiel(spec) {
  const { table, singulier, article, usageSql, messageUsage } = spec;
  const CODE_EXISTE = `${singulier.toUpperCase()}_EXISTE`;
  const CODE_UTILISE = `${singulier.toUpperCase()}_UTILISEE`;

  async function usageDe(client, id) {
    const { rows } = await client.query(usageSql, [id]);
    return rows[0] || { total: 0, actifs: 0 };
  }

  async function list(req, res) {
    const inclureInactives = req.query.inclure_inactives === 'true';
    // Le nombre de produits rattaches accompagne chaque entree : c'est ce qui
    // permet a l'interface d'expliquer un refus de suppression avant meme de
    // l'avoir tente.
    const { rows } = await pool.query(
      `SELECT r.*,
              (SELECT count(*)::int FROM produits p WHERE p.${singulier}_id = r.id) AS produits,
              (SELECT count(*)::int FROM produits p WHERE p.${singulier}_id = r.id AND p.actif) AS produits_actifs
         FROM ${table} r
        ${inclureInactives ? '' : 'WHERE r.actif = true'}
        ORDER BY r.actif DESC, r.nom`
    );
    res.json(rows);
  }

  async function create(req, res) {
    const nom = String(req.body.nom || '').trim();
    const description = String(req.body.description || '').trim();

    if (!nom) return res.status(400).json({ message: `Le nom est requis` });
    if (nom.length > 120) return res.status(400).json({ message: '120 caracteres maximum' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO ${table} (nom, description) VALUES ($1, $2) RETURNING *`,
        [nom, description || null]
      );
      await logAudit(client, {
        typeOperation: `${singulier}_creation`,
        entiteId: rows[0].id,
        utilisateurId: req.user.id,
        details: { nom },
        apres: { nom, description: description || null, actif: true },
      });
      await client.query('COMMIT');
      res.status(201).json({ ...rows[0], produits: 0, produits_actifs: 0 });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === VIOLATION_UNICITE) {
        return res.status(409).json({ message: `« ${nom} » existe deja.`, code: CODE_EXISTE });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function update(req, res) {
    const nom = req.body.nom !== undefined ? String(req.body.nom).trim() : undefined;
    const description = req.body.description !== undefined
      ? String(req.body.description).trim() : undefined;
    const actif = req.body.actif;

    if (nom !== undefined && !nom) {
      return res.status(400).json({ message: 'Le nom ne peut pas etre vide' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: avantRows } = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      const avant = avantRows[0];
      if (!avant) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Introuvable' });
      }

      const { rows } = await client.query(
        `UPDATE ${table}
            SET nom = COALESCE($1, nom),
                description = CASE WHEN $2::text IS NULL THEN description ELSE NULLIF($2, '') END,
                actif = COALESCE($3, actif),
                updated_at = now()
          WHERE id = $4 RETURNING *`,
        [nom ?? null, description ?? null, actif ?? null, req.params.id]
      );
      const apres = rows[0];

      await logAudit(client, {
        typeOperation: `${singulier}_modification`,
        entiteId: apres.id,
        utilisateurId: req.user.id,
        details: { nom: apres.nom },
        avant: { nom: avant.nom, description: avant.description, actif: avant.actif },
        apres: { nom: apres.nom, description: apres.description, actif: apres.actif },
      });

      await client.query('COMMIT');
      res.json(apres);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === VIOLATION_UNICITE) {
        return res.status(409).json({ message: 'Ce nom est deja pris.', code: CODE_EXISTE });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function supprimer(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      const entree = rows[0];
      if (!entree) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Introuvable' });
      }

      // Verification explicite avant de tenter la suppression : la cle
      // etrangere refuserait de toute facon, mais avec un message PostgreSQL
      // que personne ne peut lire. Ici on dit combien d'articles sont
      // concernes et quoi faire a la place.
      const usage = await usageDe(client, req.params.id);
      if (Number(usage.total) > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: messageUsage(entree.nom, usage),
          code: CODE_UTILISE,
          ...usage,
        });
      }

      await client.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      await logAudit(client, {
        typeOperation: `${singulier}_suppression`,
        entiteId: Number(req.params.id),
        utilisateurId: req.user.id,
        details: { nom: entree.nom },
        avant: { nom: entree.nom, description: entree.description, actif: entree.actif },
      });

      await client.query('COMMIT');
      res.json({ message: `${article} « ${entree.nom} » a ete supprimee` });
    } catch (err) {
      await client.query('ROLLBACK');
      // Filet : si une nouvelle table venait a referencer celle-ci sans que le
      // controle ci-dessus soit mis a jour, la base refuse quand meme et
      // l'utilisateur recoit un message comprehensible.
      if (err.code === VIOLATION_CLE_ETRANGERE) {
        return res.status(409).json({
          message: 'Cette valeur est utilisee ailleurs dans le systeme et ne peut pas etre supprimee.',
          code: CODE_UTILISE,
        });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  return { list, create, update, supprimer };
}

const categories = creerReferentiel({
  table: 'categories',
  singulier: 'categorie',
  article: 'La categorie',
  usageSql: `SELECT count(*)::int AS total, count(*) FILTER (WHERE actif)::int AS actifs
               FROM produits WHERE categorie_id = $1`,
  messageUsage: (nom, u) => `« ${nom} » regroupe ${u.total} produit(s)`
    + `${u.actifs ? `, dont ${u.actifs} au catalogue` : ''}. La supprimer les laisserait sans rayon. `
    + 'Desactivez-la plutot : elle disparaitra des choix proposes sans rien changer aux fiches existantes.',
});

const marques = creerReferentiel({
  table: 'marques',
  singulier: 'marque',
  article: 'La marque',
  usageSql: `SELECT count(*)::int AS total, count(*) FILTER (WHERE actif)::int AS actifs
               FROM produits WHERE marque_id = $1`,
  messageUsage: (nom, u) => `« ${nom} » est portee par ${u.total} produit(s)`
    + `${u.actifs ? `, dont ${u.actifs} au catalogue` : ''}. La supprimer les laisserait sans marque. `
    + 'Desactivez-la plutot : elle disparaitra des choix proposes sans rien changer aux fiches existantes.',
});

module.exports = { creerReferentiel, categories, marques };
