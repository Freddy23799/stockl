const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const ventesController = require('../controllers/ventes.controller');

// Vente directe (boutique) ou attribuee a une vendeuse active.
// Decremente le stock et fige (snapshot) prix de vente + cout d'acquisition.
// Lecture : admin, comptabilite et gestionnaire de stock voient toutes les
// ventes ; une vendeuse ne voit que les siennes (filtre force cote controleur).
// Ecriture : reservee a l'admin (caisse partagee) et a la vendeuse (sa propre vente).
router.get('/', requireAuth, requireRole('admin', 'vendeuse', 'comptabilite', 'gestionnaire_stock'), requireModule('ventes'), ventesController.list);
router.get('/:id', requireAuth, requireRole('admin', 'vendeuse', 'comptabilite', 'gestionnaire_stock'), requireModule('ventes'), ventesController.getById);
router.post('/', requireAuth, requireRole('admin', 'vendeuse'), requireModule('ventes'), ventesController.create);

module.exports = router;
