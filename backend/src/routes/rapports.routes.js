const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const rapportsController = require('../controllers/rapports.controller');

// Journalier / hebdomadaire / mensuel / annuel (Admin)
router.get('/journalier', requireAuth, requireRole('admin'), rapportsController.journalier);
router.get('/hebdomadaire', requireAuth, requireRole('admin'), rapportsController.hebdomadaire);
router.get('/mensuel', requireAuth, requireRole('admin'), rapportsController.mensuel);
router.get('/annuel', requireAuth, requireRole('admin'), rapportsController.annuel);

// Plage de dates personnalisee (Admin)
router.get('/', requireAuth, requireRole('admin'), rapportsController.personnalise);

// Activite recente : dernieres ventes / mouvements de stock / depenses (Admin)
router.get('/activite-recente', requireAuth, requireRole('admin'), rapportsController.activiteRecente);

// Mini-rapport pour une vendeuse donnee (par id ou par code) - usage Admin
router.get('/mini', requireAuth, requireRole('admin'), rapportsController.mini);

// Serie quotidienne (graphique de tendance) et performance produits (Admin)
router.get('/serie', requireAuth, requireRole('admin'), rapportsController.serie);
router.get('/performance-produits', requireAuth, requireRole('admin'), rapportsController.performanceProduits);

// Comparaison aujourd'hui vs hier (tableau de bord, Admin)
router.get('/comparaison-veille', requireAuth, requireRole('admin'), rapportsController.comparaisonVeille);

module.exports = router;
