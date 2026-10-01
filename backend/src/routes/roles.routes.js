const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const rolesController = require('../controllers/roles.controller');

// Reserve a l'admin de l'entreprise : voir/modifier qui a le droit de faire
// quoi n'a pas sa place hors de ce role, meme en lecture.
router.use(requireAuth);

router.get('/permissions', requirePermission('roles', 'voir'), rolesController.permissionsCatalogue);
router.get('/', requirePermission('roles', 'voir'), rolesController.listerRoles);
router.get('/matrice', requirePermission('roles', 'voir'), rolesController.matrice);
router.post('/', requirePermission('roles', 'creer'), rolesController.creerRole);
router.put('/:id/permissions', requirePermission('roles', 'modifier'), rolesController.definirPermissions);

module.exports = router;
