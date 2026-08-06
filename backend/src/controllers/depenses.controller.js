const pool = require('../config/db');
const { logAudit } = require('../db/audit');
const { getPagination } = require('../utils/pagination');

// Filtres communs a la liste et aux agregats : les deux doivent porter
// exactement sur le meme ensemble, sinon le total affiche ne correspond pas aux
// lignes qu'on voit.
function construireFiltres(query) {
  const conditions = [];
  const params = [];
  if (query.from) { params.push(query.from); conditions.push(`date >= $${params.length}`); }
  if (query.to) { params.push(query.to); conditions.push(`date <= $${params.length}`); }
  if (query.categorie) { params.push(query.categorie); conditions.push(`categorie = $${params.length}`); }
  if (query.recherche) {
    params.push(`%${String(query.recherche).trim()}%`);
    conditions.push(`(categorie ILIKE $${params.length} OR note ILIKE $${params.length})`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * Liste paginee.
 *
 * Auparavant la requete portait un `LIMIT 500` en dur, sans pagination ni
 * compteur : passe cinq cents ecritures, la liste etait tronquee EN SILENCE.
 * Les totaux calcules a l'ecran devenaient faux sans que rien ne le signale, ce
 * qui est le pire mode de defaillance possible pour un suivi de depenses.
 */
async function list(req, res) {
  const { where, params } = construireFiltres(req.query);
  const { page, pageSize, offset } = getPagination(req);

  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS total FROM depenses ${where}`,
    params
  );
  const { rows } = await pool.query(
    `SELECT * FROM depenses ${where} ORDER BY date DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );

  res.json({ data: rows, total: countRows[0].total, page, pageSize });
}

/**
 * Agregats sur TOUTE la periode filtree, pas sur la page affichee.
 *
 * Indispensable des lors que la liste est paginee : additionner les vingt
 * lignes visibles donnerait un total qui n'a aucun sens, et la repartition par
 * categorie ne refleterait que le haut de la liste.
 */
async function resume(req, res) {
  const { where, params } = construireFiltres(req.query);

  const [{ rows: totaux }, { rows: parCategorie }, { rows: parMois }] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(montant), 0) AS total, count(*)::int AS nombre,
              COALESCE(AVG(montant), 0) AS moyenne,
              MIN(date) AS premiere, MAX(date) AS derniere
         FROM depenses ${where}`,
      params
    ),
    pool.query(
      `SELECT categorie, count(*)::int AS nombre, COALESCE(SUM(montant), 0) AS montant
         FROM depenses ${where}
        GROUP BY categorie ORDER BY montant DESC`,
      params
    ),
    pool.query(
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS mois,
              COALESCE(SUM(montant), 0) AS montant, count(*)::int AS nombre
         FROM depenses ${where}
        GROUP BY 1 ORDER BY 1`,
      params
    ),
  ]);

  const total = Number(totaux[0].total);
  res.json({
    ...totaux[0],
    par_categorie: parCategorie.map((c) => ({
      ...c,
      part: total > 0 ? Number(c.montant) / total : 0,
    })),
    par_mois: parMois,
  });
}

/** Categories deja utilisees, pour la saisie assistee et les filtres. */
async function categories(req, res) {
  const { rows } = await pool.query(
    `SELECT categorie, count(*)::int AS nombre FROM depenses
      GROUP BY categorie ORDER BY nombre DESC, categorie`
  );
  res.json(rows);
}

async function create(req, res) {
  const { categorie, montant, note, date } = req.body;
  if (!categorie || !(Number(montant) >= 0)) {
    return res.status(400).json({ message: 'categorie et montant (>= 0) sont requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO depenses (categorie, montant, note, auteur_id, date)
       VALUES ($1, $2, $3, $4, COALESCE($5, now())) RETURNING *`,
      [categorie, montant, note || null, req.user.id, date || null]
    );
    await logAudit(client, {
      typeOperation: 'depense_creation',
      entiteId: rows[0].id,
      utilisateurId: req.user.id,
      details: { categorie: rows[0].categorie, montant: rows[0].montant },
      apres: {
        categorie: rows[0].categorie,
        montant: rows[0].montant,
        note: rows[0].note,
        date: rows[0].date,
      },
    });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { list, create, resume, categories };
