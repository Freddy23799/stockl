const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const exportsController = require('../controllers/exports.controller');

// Un document imprime sort autant de donnees qu'un ecran entier : il est soumis
// aux memes controles d'acces, module par module.
router.use(requireAuth, requireRole('admin'));

router.get('/synthese.pdf', exportsController.synthese);
router.get('/ventes.pdf', requireModule('ventes'), exportsController.ventes);
router.get('/stock.pdf', exportsController.stock);
router.get('/produits.pdf', exportsController.produits);
router.get('/depenses.pdf', requireModule('depenses'), exportsController.depenses);
router.get('/mouvements.pdf', exportsController.mouvements);
router.get('/historique.pdf', exportsController.historique);

module.exports = router;
