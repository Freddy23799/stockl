const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const utilisateursController = require('../controllers/utilisateurs.controller');

// Gestion des comptes : Administrateur uniquement
router.get('/', requireAuth, requirePermission('utilisateurs', 'voir'), utilisateursController.list);
router.post('/', requireAuth, requirePermission('utilisateurs', 'creer'), utilisateursController.create);
router.patch('/:id', requireAuth, requirePermission('utilisateurs', 'modifier'), utilisateursController.modifier);
// Reinitialisation par un administrateur : le seul recours quand un mot de
// passe est perdu, puisqu'il n'est stocke qu'en hash et qu'aucun envoi par
// email n'existe.
router.post('/:id/reinitialiser-mot-de-passe', requireAuth, requirePermission('utilisateurs', 'modifier'), utilisateursController.reinitialiserMotDePasse);
// Son propre mot de passe : pas de requireRole, chacun change le sien.
router.patch('/moi/mot-de-passe', requireAuth, utilisateursController.changerMotDePasse);
router.patch('/:id/desactiver', requireAuth, requirePermission('utilisateurs', 'archiver'), utilisateursController.desactiver);
router.patch('/:id/reactiver', requireAuth, requirePermission('utilisateurs', 'archiver'), utilisateursController.reactiver);

module.exports = router;
