const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const notificationsController = require('../controllers/notifications.controller');

// Cloche de notifications (stock bas pour l'instant) : admin et gestionnaire
// de stock, les deux roles concernes par le reapprovisionnement.
router.use(requireAuth, requirePermission('notifications', 'voir'));

router.get('/', notificationsController.list);
router.get('/compte-non-lues', notificationsController.compteNonLues);
router.patch('/:id/lu', requirePermission('notifications', 'modifier'), notificationsController.marquerLue);
router.patch('/lu-tout', requirePermission('notifications', 'modifier'), notificationsController.marquerToutLu);

module.exports = router;
