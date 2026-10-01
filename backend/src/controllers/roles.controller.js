const pool = require('../config/db');
const { logAudit } = require('../db/audit');

// Gestion de la matrice roles x permissions, par entreprise.
//
// IMPORTANT : cette matrice est pour l'instant DESCRIPTIVE. L'autorisation
// reelle, sur chaque requete, reste faite par requireRole()/requireModule()
// (voir middleware/auth.middleware.js et module.middleware.js). La modifier
// ici documente et prepare la bascule vers un controle reellement dynamique,
// mais ne change pas encore le comportement du serveur. Voir la migration
// 032_rbac_matrice.sql pour le detail de cette decision.

async function permissionsCatalogue(req, res) {
  const { rows } = await pool.query(
    'SELECT id, module, action FROM permissions ORDER BY module, action'
  );
  res.json(rows);
}

async function listerRoles(req, res) {
  const { rows } = await pool.query(
    `SELECT id, code, nom, systeme, super_admin, created_at,
            (SELECT count(*)::int FROM utilisateurs u WHERE u.role = roles.code AND u.entreprise_id = roles.entreprise_id) AS nombre_comptes
       FROM roles
      WHERE entreprise_id = $1
      ORDER BY super_admin DESC, systeme DESC, nom`,
    [req.user.entrepriseId]
  );
  res.json(rows);
}

async function matrice(req, res) {
  const { rows } = await pool.query(
    `SELECT rp.role_id, rp.permission_id, rp.perimetre
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
      WHERE r.entreprise_id = $1`,
    [req.user.entrepriseId]
  );
  res.json(rows);
}

async function creerRole(req, res) {
  const { code, nom } = req.body;
  if (!code || !String(code).trim() || !nom || !String(nom).trim()) {
    return res.status(400).json({ message: 'Le code et le nom du role sont requis' });
  }
  const codeNormalise = String(code).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');

  try {
    const { rows } = await pool.query(
      `INSERT INTO roles (entreprise_id, code, nom, systeme, super_admin)
       VALUES ($1, $2, $3, false, false)
       RETURNING id, code, nom, systeme, super_admin, created_at`,
      [req.user.entrepriseId, codeNormalise, String(nom).trim()]
    );
    await logAudit(pool, {
      typeOperation: 'role_creation',
      entiteId: rows[0].id,
      utilisateurId: req.user.id,
      entrepriseId: req.user.entrepriseId,
      details: { code: rows[0].code, nom: rows[0].nom },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Un role avec ce code existe deja dans cette entreprise' });
    }
    throw err;
  }
}

// Remplace l'ensemble des permissions d'un role en une fois (la case a cocher
// de la matrice envoie l'etat complet, pas une permission a la fois) : plus
// simple et plus sur qu'un accumulate de PATCH un par un qui peut diverger de
// ce que l'ecran affiche.
async function definirPermissions(req, res) {
  const { id } = req.params;
  const { permissions: permissionsDemandees } = req.body;
  if (!Array.isArray(permissionsDemandees)) {
    return res.status(400).json({ message: 'permissions doit etre un tableau' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: roleRows } = await client.query(
      'SELECT id, code, nom, super_admin FROM roles WHERE id = $1 AND entreprise_id = $2 FOR UPDATE',
      [id, req.user.entrepriseId]
    );
    if (roleRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Role introuvable' });
    }
    const role = roleRows[0];
    if (role.super_admin) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Un role super-admin voit deja tout : sa matrice ne se modifie pas.',
        code: 'ROLE_SUPER_ADMIN',
      });
    }

    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);

    for (const item of permissionsDemandees) {
      const perimetre = ['own', 'team', 'department', 'branch', 'company', 'global'].includes(item.perimetre)
        ? item.perimetre
        : 'company';
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, perimetre) VALUES ($1, $2, $3)`,
        [id, item.permission_id, perimetre]
      );
    }

    await logAudit(client, {
      typeOperation: 'role_permissions_modification',
      entiteId: Number(id),
      utilisateurId: req.user.id,
      entrepriseId: req.user.entrepriseId,
      details: { code: role.code, nom: role.nom, nombre_permissions: permissionsDemandees.length },
    });

    await client.query('COMMIT');
    res.json({ message: 'Permissions mises a jour' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { permissionsCatalogue, listerRoles, matrice, creerRole, definirPermissions };
