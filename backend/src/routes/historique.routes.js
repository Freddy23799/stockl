const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const historiqueController = require('../controllers/historique.controller');

// Admin uniquement : audit de toutes les operations (ventes, entrees/sorties de stock, ...)
// Filtrable par type d'operation, utilisateur, periode
router.get('/', requireAuth, requirePermission('historique', 'voir'), historiqueController.list);

module.exports = router;
