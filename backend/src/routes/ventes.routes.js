const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const ventesController = require('../controllers/ventes.controller');

// Vente directe (boutique) ou attribuee a une vendeuse active.
// Decremente le stock et fige (snapshot) prix de vente + cout d'acquisition.
router.get('/', requireAuth, requireModule('ventes'), ventesController.list);
router.get('/:id', requireAuth, requireModule('ventes'), ventesController.getById);
router.post('/', requireAuth, requireModule('ventes'), ventesController.create);

module.exports = router;
