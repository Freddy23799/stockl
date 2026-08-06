const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const depensesController = require('../controllers/depenses.controller');

router.use(requireAuth, requireRole('admin'), requireModule('depenses'));

// Agregats sur toute la periode filtree : la liste etant paginee, additionner
// la page affichee donnerait un total faux.
router.get('/resume', requireAuth, requireRole('admin'), depensesController.resume);
router.get('/categories', requireAuth, requireRole('admin'), depensesController.categories);

router.get('/', depensesController.list);
router.post('/', depensesController.create);

module.exports = router;
