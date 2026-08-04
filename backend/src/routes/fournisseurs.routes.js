const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const fournisseursController = require('../controllers/fournisseurs.controller');

router.use(requireAuth, requireRole('admin'), requireModule('fournisseurs'));

router.get('/', fournisseursController.list);
router.get('/totaux', fournisseursController.listAvecTotaux);
router.get('/:id', fournisseursController.getById);
router.post('/', fournisseursController.create);
router.put('/:id', fournisseursController.update);
router.patch('/:id/activer', fournisseursController.activer);
router.patch('/:id/desactiver', fournisseursController.desactiver);
router.get('/:id/historique', fournisseursController.historique);
router.get('/:id/total', fournisseursController.total);

module.exports = router;
