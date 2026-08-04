const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { uploadLogo } = require('../middleware/upload.middleware');
const parametresController = require('../controllers/parametres.controller');

// Admin uniquement : logo boutique, methode FIFO/CMP par defaut, autres reglages globaux
router.get('/', requireAuth, parametresController.get);
router.put('/', requireAuth, requireRole('admin'), parametresController.update);
router.post('/logo', requireAuth, requireRole('admin'), uploadLogo.single('logo'), parametresController.uploadLogo);

module.exports = router;
