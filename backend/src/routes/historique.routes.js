const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const historiqueController = require('../controllers/historique.controller');

// Admin uniquement : audit de toutes les operations (ventes, entrees/sorties de stock, ...)
// Filtrable par type d'operation, utilisateur, periode
router.get('/', requireAuth, requireRole('admin'), historiqueController.list);

module.exports = router;
