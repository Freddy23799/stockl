const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const rapportsController = require('../controllers/rapports.controller');

// Rapports financiers : Admin, et Comptabilite en lecture seule (aucune de
// ces routes n'ecrit rien, le meme requireRole convient donc a tout le fichier).
router.use(requireAuth, requireRole('admin', 'comptabilite'));

// Journalier / hebdomadaire / mensuel / annuel
router.get('/journalier', rapportsController.journalier);
router.get('/hebdomadaire', rapportsController.hebdomadaire);
router.get('/mensuel', rapportsController.mensuel);
router.get('/annuel', rapportsController.annuel);

// Plage de dates personnalisee
router.get('/', rapportsController.personnalise);

// Activite recente : dernieres ventes / mouvements de stock / depenses
router.get('/activite-recente', rapportsController.activiteRecente);

// Mini-rapport pour une vendeuse donnee (par id ou par code)
router.get('/mini', rapportsController.mini);

// Serie quotidienne (graphique de tendance) et performance produits
router.get('/serie', rapportsController.serie);
router.get('/performance-produits', rapportsController.performanceProduits);

// Comparaison aujourd'hui vs hier (tableau de bord)
router.get('/comparaison-veille', rapportsController.comparaisonVeille);

module.exports = router;
