const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const { loginLimiter } = require('../middleware/rateLimit.middleware');
const authController = require('../controllers/auth.controller');

router.post('/login', loginLimiter, authController.login);
router.get('/me', requireAuth, authController.me);

module.exports = router;
