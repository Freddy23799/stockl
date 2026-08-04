const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const depensesController = require('../controllers/depenses.controller');

router.use(requireAuth, requireRole('admin'), requireModule('depenses'));

router.get('/', depensesController.list);
router.post('/', depensesController.create);

module.exports = router;
