const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/utilisateurs', require('./utilisateurs.routes'));
router.use('/produits', require('./produits.routes'));
router.use('/fournisseurs', require('./fournisseurs.routes'));
router.use('/vendeuses', require('./vendeuses.routes'));
router.use('/ventes', require('./ventes.routes'));
router.use('/stock', require('./stock.routes'));
router.use('/depenses', require('./depenses.routes'));
router.use('/rapports', require('./rapports.routes'));
router.use('/parametres', require('./parametres.routes'));
router.use('/historique', require('./historique.routes'));
router.use('/exports', require('./exports.routes'));

module.exports = router;
