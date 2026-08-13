const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const notificationsController = require('../controllers/notifications.controller');

// Cloche de notifications (stock bas pour l'instant) : admin et gestionnaire
// de stock, les deux roles concernes par le reapprovisionnement.
router.use(requireAuth, requireRole('admin', 'gestionnaire_stock'));

router.get('/', notificationsController.list);
router.get('/compte-non-lues', notificationsController.compteNonLues);
router.patch('/:id/lu', notificationsController.marquerLue);
router.patch('/lu-tout', notificationsController.marquerToutLu);

module.exports = router;
