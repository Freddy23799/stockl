const express = require('express');
const router = express.Router();
const { requireAuth, requireOperateurPlateforme } = require('../middleware/auth.middleware');
const entreprisesController = require('../controllers/entreprises.controller');

// Reserve a l'operateur de la plateforme : un admin d'entreprise cliente n'a
// aucune raison de voir ou gerer les autres entreprises.
router.use(requireAuth, requireOperateurPlateforme);

router.get('/', entreprisesController.list);
router.post('/', entreprisesController.create);
router.patch('/:id/bloquer', entreprisesController.bloquer);
router.patch('/:id/desactiver', entreprisesController.desactiver);
router.patch('/:id/reactiver', entreprisesController.reactiver);

module.exports = router;
