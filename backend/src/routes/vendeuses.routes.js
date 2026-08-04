const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const vendeusesController = require('../controllers/vendeuses.controller');

// Les vendeuses n'existent que pour attribuer des ventes : rattachees au module Ventes.
router.use(requireAuth, requireRole('admin'), requireModule('ventes'));

router.get('/', vendeusesController.list);
router.get('/code/:code', vendeusesController.getByCode);
router.post('/', vendeusesController.create);
router.put('/:id', vendeusesController.update);
router.patch('/:id/activer', vendeusesController.activer);
router.patch('/:id/desactiver', vendeusesController.desactiver);

module.exports = router;
