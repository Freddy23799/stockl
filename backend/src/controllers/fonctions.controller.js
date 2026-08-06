const pool = require('../config/db');
const { logAudit } = require('../db/audit');

// -----------------------------------------------------------------------------
// Fonctions du personnel.
//
// Reference fermee plutot que saisie libre : sans elle, "Vendeuse", "vendeuse"
// et "Vendeuse " comptent pour trois metiers distincts et tous les
// regroupements deviennent faux.
//
// Une fonction n'est jamais supprimee si elle est portee par une periode de
// carriere : cette periode a servi de base a des bulletins de paie. La cle
// etrangere en RESTRICT le garantit cote base ; le controle ci-dessous ne sert
// qu'a rendre le refus explicable.
// -----------------------------------------------------------------------------

// Violation de cle etrangere : PostgreSQL la signale par ce code.
const VIOLATION_CLE_ETRANGERE = '23503';
const VIOLATION_UNICITE = '23505';

async function list(req, res) {
  const inclureInactives = req.query.inclure_inactives === 'true';

  // L'effectif accompagne chaque fonction : c'est ce qui permet a l'interface
  // de dire pourquoi une suppression est refusee, avant meme de l'essayer.
  const { rows } = await pool.query(
    `SELECT f.*,
            COALESCE(c.effectif, 0) AS effectif,
            COALESCE(c.periodes, 0) AS periodes
       FROM fonctions f
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE date_fin IS NULL)::int AS effectif,
                count(*)::int AS periodes
           FROM employes_carriere ec WHERE ec.fonction_id = f.id
       ) c ON true
      ${inclureInactives ? '' : 'WHERE f.actif = true'}
      ORDER BY f.actif DESC, f.nom`
  );
  res.json(rows);
}

async function create(req, res) {
  const nom = String(req.body.nom || '').trim();
  const description = String(req.body.description || '').trim();

  if (!nom) return res.status(400).json({ message: 'Le nom de la fonction est requis' });
  if (nom.length > 120) return res.status(400).json({ message: '120 caracteres maximum' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO fonctions (nom, description) VALUES ($1, $2) RETURNING *',
      [nom, description || null]
    );
    await logAudit(client, {
      typeOperation: 'fonction_creation',
      entiteId: rows[0].id,
      utilisateurId: req.user.id,
      details: { nom },
      apres: { nom, description: description || null, actif: true },
    });
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], effectif: 0, periodes: 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === VIOLATION_UNICITE) {
      return res.status(409).json({
        message: `La fonction « ${nom} » existe deja.`,
        code: 'FONCTION_EXISTE',
      });
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
    return res.status(400).json({ message: 'Le nom de la fonction ne peut pas etre vide' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: avantRows } = await client.query('SELECT * FROM fonctions WHERE id = $1', [req.params.id]);
    const avant = avantRows[0];
    if (!avant) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Fonction introuvable' });
    }

    const { rows } = await client.query(
      `UPDATE fonctions
          SET nom = COALESCE($1, nom),
              description = CASE WHEN $2::text IS NULL THEN description ELSE NULLIF($2, '') END,
              actif = COALESCE($3, actif),
              updated_at = now()
        WHERE id = $4 RETURNING *`,
      [nom ?? null, description ?? null, actif ?? null, req.params.id]
    );
    const apres = rows[0];

    // Renommer une fonction ne reecrit PAS l'historique : les periodes de
    // carriere gardent le libelle porte a l'epoque. C'est voulu, et il faut le
    // dire, sinon on croit a un bug en voyant l'ancien titre sur un bulletin.
    await logAudit(client, {
      typeOperation: 'fonction_modification',
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
      return res.status(409).json({ message: 'Une autre fonction porte deja ce nom.', code: 'FONCTION_EXISTE' });
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

    const { rows: fonctionRows } = await client.query(
      'SELECT * FROM fonctions WHERE id = $1',
      [req.params.id]
    );
    const fonction = fonctionRows[0];
    if (!fonction) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Fonction introuvable' });
    }

    // Verification explicite avant de tenter la suppression : la cle etrangere
    // refuserait de toute facon, mais avec un message PostgreSQL que personne ne
    // peut lire. Ici on dit combien de personnes sont concernees et quoi faire.
    const { rows: usageRows } = await client.query(
      `SELECT count(*)::int AS periodes,
              count(*) FILTER (WHERE date_fin IS NULL)::int AS en_cours
         FROM employes_carriere WHERE fonction_id = $1`,
      [req.params.id]
    );
    const usage = usageRows[0];

    if (usage.periodes > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: usage.en_cours > 0
          ? `« ${fonction.nom} » est occupee par ${usage.en_cours} employe(s) et figure dans `
            + `${usage.periodes} periode(s) de carriere. Elle ne peut pas etre supprimee sans effacer `
            + "une partie de l'historique de paie. Desactivez-la : elle disparaitra des choix "
            + 'proposes sans toucher au passe.'
          : `« ${fonction.nom} » figure dans ${usage.periodes} periode(s) de carriere passee(s). `
            + 'La supprimer effacerait une partie de l\'historique de paie. Desactivez-la plutot.',
        code: 'FONCTION_UTILISEE',
        effectif: usage.en_cours,
        periodes: usage.periodes,
      });
    }

    await client.query('DELETE FROM fonctions WHERE id = $1', [req.params.id]);
    await logAudit(client, {
      typeOperation: 'fonction_suppression',
      entiteId: Number(req.params.id),
      utilisateurId: req.user.id,
      details: { nom: fonction.nom },
      avant: { nom: fonction.nom, description: fonction.description, actif: fonction.actif },
    });

    await client.query('COMMIT');
    res.json({ message: `Fonction « ${fonction.nom} » supprimee` });
  } catch (err) {
    await client.query('ROLLBACK');
    // Filet de securite : si une nouvelle table venait a referencer les
    // fonctions sans que le controle ci-dessus soit mis a jour, la base refuse
    // quand meme et l'utilisateur recoit un message comprehensible.
    if (err.code === VIOLATION_CLE_ETRANGERE) {
      return res.status(409).json({
        message: 'Cette fonction est utilisee ailleurs dans le systeme et ne peut pas etre supprimee.',
        code: 'FONCTION_UTILISEE',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { list, create, update, supprimer };
