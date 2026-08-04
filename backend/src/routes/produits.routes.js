const express = require('express');
const router = express.Router();
const { uploadProduitPhoto } = require('../middleware/upload.middleware');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const produitsController = require('../controllers/produits.controller');

// Catalogue produits : nom, prix de vente, unite de stock/achat, facteur de conversion
router.get('/', requireAuth, produitsController.list);
router.get('/:id', requireAuth, produitsController.getById);
router.post('/', requireAuth, requireRole('admin'), produitsController.create);
router.put('/:id', requireAuth, requireRole('admin'), produitsController.update);
router.patch('/:id/desactiver', requireAuth, requireRole('admin'), produitsController.desactiver);

// Photo produit : fichier sur disque (uploads/produits/), la fiche ne stocke que le chemin
router.post('/:id/photo', requireAuth, requireRole('admin'), uploadProduitPhoto.single('photo'), produitsController.uploadPhoto);

// Historique des prix d'un produit
router.get('/:id/historique-prix', requireAuth, produitsController.historiquePrix);

module.exports = router;
