const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const { uploadLogo } = require('../middleware/upload.middleware');
const parametresController = require('../controllers/parametres.controller');

// Admin uniquement : logo boutique, methode FIFO/CMP par defaut, autres reglages globaux
router.get('/', requireAuth, requirePermission('parametres', 'voir'), parametresController.get);
router.put('/', requireAuth, requirePermission('parametres', 'modifier'), parametresController.update);
router.post('/logo', requireAuth, requirePermission('parametres', 'modifier'), uploadLogo.single('logo'), parametresController.uploadLogo);

module.exports = router;
