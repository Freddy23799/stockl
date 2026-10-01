const pool = require('../config/db');

// Resolution centralisee de la matrice RBAC. Les routes passent toujours par
// ce middleware : aucune vue Vue ni aucun code client ne decide d'un acces.
// Une surcharge `refuse` l'emporte sur le role; `accorde` permet l'exception
// ponctuelle. Le role super_admin reste volontairement sans restriction.
async function permissionPourUtilisateur(utilisateurId, entrepriseId, roleCode, module, action) {
  if (!entrepriseId || roleCode === 'operateur') return null;

  const { rows } = await pool.query(
    `SELECT r.super_admin,
            up.effet AS surcharge_effet,
            COALESCE(up.perimetre, rp.perimetre) AS perimetre
       FROM roles r
       JOIN permissions p ON p.module = $4 AND p.action = $5
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id
       LEFT JOIN utilisateur_permissions up
              ON up.utilisateur_id = $1 AND up.permission_id = p.id
      WHERE r.entreprise_id = $2 AND r.code = $3`,
    [utilisateurId, entrepriseId, roleCode, module, action]
  );
  const droit = rows[0];
  if (!droit || droit.surcharge_effet === 'refuse') return null;
  if (droit.super_admin || droit.surcharge_effet === 'accorde' || droit.perimetre) return droit;
  return null;
}

function requirePermission(module, action) {
  return async (req, res, next) => {
    try {
      const droit = await permissionPourUtilisateur(
        req.user?.id, req.user?.entrepriseId, req.user?.role, module, action
      );
      if (!droit) {
        return res.status(403).json({
          message: 'Permission insuffisante', code: 'PERMISSION_REFUSEE', module, action,
        });
      }
      req.permission = { module, action, perimetre: droit.perimetre || 'global' };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requirePermission, permissionPourUtilisateur };
