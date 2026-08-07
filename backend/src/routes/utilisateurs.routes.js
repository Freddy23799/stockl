const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const utilisateursController = require('../controllers/utilisateurs.controller');

// Gestion des comptes : Administrateur uniquement
router.get('/', requireAuth, requireRole('admin'), utilisateursController.list);
router.post('/', requireAuth, requireRole('admin'), utilisateursController.create);
router.patch('/:id', requireAuth, requireRole('admin'), utilisateursController.modifier);
// Reinitialisation par un administrateur : le seul recours quand un mot de
// passe est perdu, puisqu'il n'est stocke qu'en hash et qu'aucun envoi par
// email n'existe.
router.post('/:id/reinitialiser-mot-de-passe', requireAuth, requireRole('admin'), utilisateursController.reinitialiserMotDePasse);
// Son propre mot de passe : pas de requireRole, chacun change le sien.
router.patch('/moi/mot-de-passe', requireAuth, utilisateursController.changerMotDePasse);
router.patch('/:id/desactiver', requireAuth, requireRole('admin'), utilisateursController.desactiver);
router.patch('/:id/reactiver', requireAuth, requireRole('admin'), utilisateursController.reactiver);

module.exports = router;
