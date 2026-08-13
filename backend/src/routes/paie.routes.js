const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const paie = require('../controllers/paie.controller');

router.use(requireAuth, requireModule('paie'));

// Onglet 1 : cycles de paie. La consultation est ouverte a la comptabilite,
// mais toute ecriture (creation, cloture, ajustement, versement) reste
// reservee a l'admin - la paie engage de l'argent reellement verse.
router.get('/cycles', requireRole('admin', 'comptabilite'), paie.listerCycles);
router.post('/cycles', requireRole('admin'), paie.creer);
router.get('/cycles/:id', requireRole('admin', 'comptabilite'), paie.obtenirCycle);
router.patch('/cycles/:id/cloturer', requireRole('admin'), paie.cloturer);

// Ajustement particulier et versement, sur une ligne du cycle
router.patch('/lignes/:ligneId/ajustement', requireRole('admin'), paie.ajuster);
router.post('/lignes/:ligneId/versements', requireRole('admin'), paie.payer);

// Onglet 2 : historique des recus, recherche par numero / matricule / nom
router.get('/recus', requireRole('admin', 'comptabilite'), paie.listerRecus);

// Onglet 3 : statistiques
router.get('/statistiques', requireRole('admin', 'comptabilite'), paie.statistiques);
router.get('/employes/:id/historique', requireRole('admin', 'comptabilite'), paie.historiqueEmploye);

module.exports = router;
