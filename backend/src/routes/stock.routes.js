const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const stockController = require('../controllers/stock.controller');

// Etat du stock, seuils d'alerte, valorisation FIFO/CMP
router.get('/', requireAuth, stockController.etat);
router.get('/alertes', requireAuth, stockController.alertes);

// Entree de stock (ravitaillement) : quantite + cout d'achat (unite d'achat -> conversion)
router.post('/entrees', requireAuth, requireRole('admin', 'gestionnaire_stock'), stockController.creerEntree);

// Ajustement hors vente : inventaire physique, perte, casse, vol, retour client
router.post('/ajustements', requireAuth, requireRole('admin', 'gestionnaire_stock'), stockController.ajuster);

// Historique des mouvements (entrees/sorties), filtrable par produit/type/motif/periode
router.get('/mouvements', requireAuth, requireRole('admin', 'gestionnaire_stock'), stockController.mouvements);

module.exports = router;
