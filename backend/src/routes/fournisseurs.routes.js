const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const { requireModule } = require('../middleware/module.middleware');
const fournisseursController = require('../controllers/fournisseurs.controller');

router.use(requireAuth, requireModule('fournisseurs'));

router.get('/', requirePermission('fournisseurs', 'voir'), fournisseursController.list);
router.get('/totaux', requirePermission('fournisseurs', 'voir'), fournisseursController.listAvecTotaux);
router.get('/:id', requirePermission('fournisseurs', 'voir'), fournisseursController.getById);
router.post('/', requirePermission('fournisseurs', 'creer'), fournisseursController.create);
router.put('/:id', requirePermission('fournisseurs', 'modifier'), fournisseursController.update);
router.patch('/:id/activer', requirePermission('fournisseurs', 'modifier'), fournisseursController.activer);
router.patch('/:id/desactiver', requirePermission('fournisseurs', 'modifier'), fournisseursController.desactiver);
router.get('/:id/historique', requirePermission('fournisseurs', 'voir'), fournisseursController.historique);
router.get('/:id/total', requirePermission('fournisseurs', 'voir'), fournisseursController.total);

module.exports = router;
