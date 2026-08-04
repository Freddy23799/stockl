const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const utilisateursController = require('../controllers/utilisateurs.controller');

// Gestion des comptes : Administrateur uniquement
router.get('/', requireAuth, requireRole('admin'), utilisateursController.list);
router.post('/', requireAuth, requireRole('admin'), utilisateursController.create);
router.patch('/:id/desactiver', requireAuth, requireRole('admin'), utilisateursController.desactiver);

module.exports = router;
