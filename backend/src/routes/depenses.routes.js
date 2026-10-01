const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const { requireModule } = require('../middleware/module.middleware');
const depensesController = require('../controllers/depenses.controller');

router.use(requireAuth, requireModule('depenses'));

// Agregats sur toute la periode filtree : la liste etant paginee, additionner
// la page affichee donnerait un total faux.
router.get('/resume', requirePermission('depenses', 'voir'), depensesController.resume);
router.get('/categories', requirePermission('depenses', 'voir'), depensesController.categories);

router.get('/', requirePermission('depenses', 'voir'), depensesController.list);
router.post('/', requirePermission('depenses', 'creer'), depensesController.create);

module.exports = router;
