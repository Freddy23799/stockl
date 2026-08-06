const pool = require('../config/db');
const { logAudit } = require('../db/audit');

function genererCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Genere un code a 6 chiffres unique. Le code identifie une vendeuse de facon
// permanente - il n'est jamais reattribue ni modifie apres creation.
async function genererCodeUnique(client) {
  for (let tentative = 0; tentative < 20; tentative += 1) {
    const code = genererCode();
    const { rows } = await client.query('SELECT 1 FROM vendeuses WHERE code = $1', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Impossible de generer un code vendeuse unique');
}

async function getByCode(req, res) {
  const { rows } = await pool.query('SELECT * FROM vendeuses WHERE code = $1', [req.params.code]);
  if (rows.length === 0) return res.status(404).json({ message: 'Aucune vendeuse avec ce code' });
  res.json(rows[0]);
}

async function list(req, res) {
  const includeInactives = req.query.includeInactifs === 'true';
  const { rows } = await pool.query(
    includeInactives
      ? 'SELECT * FROM vendeuses ORDER BY nom'
      : 'SELECT * FROM vendeuses WHERE actif = true ORDER BY nom'
  );
  res.json(rows);
}

/**
 * Une vendeuse est un ROLE attribue a un employe, pas une fiche autonome.
 *
 * Le nom et le contact ne sont plus saisis : ils viennent de la fiche employe.
 * Sans cela une meme personne existerait deux fois dans le systeme, avec deux
 * orthographes et deux numeros de telephone, et plus personne ne saurait
 * laquelle fait foi.
 *
 * L'employe se choisit dans la liste COMPLETE, sans filtrer sur sa fonction :
 * une gerante ou une stagiaire peut tenir la caisse un samedi sans que sa
 * fonction officielle soit "vendeuse".
 */
async function create(req, res) {
  const { employe_id } = req.body;
  if (!employe_id) {
    return res.status(400).json({
      message: 'Choisissez l\'employe a qui attribuer ce role de vente',
      code: 'EMPLOYE_REQUIS',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: employes } = await client.query(
      'SELECT id, prenom, nom, telephone, actif FROM employes WHERE id = $1',
      [employe_id]
    );
    const employe = employes[0];
    if (!employe) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Employe introuvable' });
    }
    if (!employe.actif) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Cet employe est archive : il ne peut pas encaisser.',
        code: 'EMPLOYE_ARCHIVE',
      });
    }

    const { rows: dejaRows } = await client.query(
      'SELECT id, code, actif FROM vendeuses WHERE employe_id = $1',
      [employe_id]
    );
    if (dejaRows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: dejaRows[0].actif
          ? 'Cet employe a deja un code de vente.'
          : 'Cet employe a deja un code de vente, actuellement desactive. Reactivez-le plutot que d\'en creer un second.',
        code: 'DEJA_VENDEUSE',
        vendeuse_id: dejaRows[0].id,
      });
    }

    const nomComplet = `${employe.prenom} ${employe.nom}`.trim();
    const code = await genererCodeUnique(client);
    const { rows } = await client.query(
      'INSERT INTO vendeuses (nom, contact, code, employe_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [nomComplet, employe.telephone || null, code, employe_id]
    );

    await logAudit(client, {
      typeOperation: 'vendeuse_creation',
      entiteId: rows[0].id,
      utilisateurId: req.user?.id,
      details: { vendeuse_nom: nomComplet, employe_id },
      apres: { nom: rows[0].nom, contact: rows[0].contact, actif: rows[0].actif },
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

async function update(req, res) {
  const { id } = req.params;
  const { nom, contact } = req.body;
  const { rows } = await pool.query(
    `UPDATE vendeuses SET nom = COALESCE($1, nom), contact = COALESCE($2, contact) WHERE id = $3 RETURNING *`,
    [nom, contact, id]
  );
  if (rows.length === 0) return res.status(404).json({ message: 'Vendeuse introuvable' });
  res.json(rows[0]);
}

function setActif(actif) {
  return async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existantes } = await client.query('SELECT * FROM vendeuses WHERE id = $1 FOR UPDATE', [id]);
      if (existantes.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Vendeuse introuvable' });
      }
      const existante = existantes[0];

      const { rows } = await client.query(
        'UPDATE vendeuses SET actif = $1 WHERE id = $2 RETURNING *',
        [actif, id]
      );
      await logAudit(client, {
        typeOperation: actif ? 'vendeuse_activation' : 'vendeuse_desactivation',
        entiteId: Number(id),
        utilisateurId: req.user?.id,
        details: { vendeuse_nom: existante.nom, code: existante.code },
        avant: { actif: existante.actif },
        apres: { actif: rows[0].actif },
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

// Regeneration du code d'une vendeuse.
//
// Le code a six chiffres est un secret partage : il suffit a attribuer une vente
// a quelqu'un. S'il circule (note oubliee sur le comptoir, depart de la
// personne), il faut pouvoir le remplacer sans supprimer la fiche, sinon tout
// l'historique de ses ventes serait perdu.
//
// L'ancien code n'est pas journalise : le mettre au journal reviendrait a le
// laisser lisible par la personne meme a qui on vient de le retirer.
async function regenererCode(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existanteRows } = await client.query(
      'SELECT * FROM vendeuses WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const existante = existanteRows[0];
    if (!existante) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Vendeuse introuvable' });
    }

    const nouveauCode = await genererCodeUnique(client);
    const { rows } = await client.query(
      'UPDATE vendeuses SET code = $1 WHERE id = $2 RETURNING *',
      [nouveauCode, req.params.id]
    );

    await logAudit(client, {
      typeOperation: 'vendeuse_code_regenere',
      entiteId: Number(req.params.id),
      utilisateurId: req.user.id,
      details: { vendeuse_nom: existante.nom },
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
  list, getByCode, create, update, regenererCode,
  activer: setActif(true), desactiver: setActif(false),
};
