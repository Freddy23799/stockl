const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const utilisateursController = require('../controllers/utilisateurs.controller');

// Gestion des comptes : Administrateur uniquement
router.get('/', requireAuth, requireRole('admin'), utilisateursController.list);
router.post('/', requireAuth, requireRole('admin'), utilisateursController.create);
// Son propre mot de passe : pas de requireRole, chacun change le sien.
router.patch('/moi/mot-de-passe', requireAuth, utilisateursController.changerMotDePasse);
router.patch('/:id/desactiver', requireAuth, requireRole('admin'), utilisateursController.desactiver);
router.patch('/:id/reactiver', requireAuth, requireRole('admin'), utilisateursController.reactiver);

module.exports = router;
