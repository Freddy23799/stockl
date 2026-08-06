const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const paie = require('../controllers/paie.controller');

router.use(requireAuth, requireRole('admin'), requireModule('paie'));

// Onglet 1 : cycles de paie
router.get('/cycles', paie.listerCycles);
router.post('/cycles', paie.creer);
router.get('/cycles/:id', paie.obtenirCycle);
router.patch('/cycles/:id/cloturer', paie.cloturer);

// Ajustement particulier et versement, sur une ligne du cycle
router.patch('/lignes/:ligneId/ajustement', paie.ajuster);
router.post('/lignes/:ligneId/versements', paie.payer);

// Onglet 2 : historique des recus, recherche par numero / matricule / nom
router.get('/recus', paie.listerRecus);

// Onglet 3 : statistiques
router.get('/statistiques', paie.statistiques);
router.get('/employes/:id/historique', paie.historiqueEmploye);

module.exports = router;
