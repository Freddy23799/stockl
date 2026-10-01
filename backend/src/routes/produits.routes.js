const express = require('express');
const router = express.Router();
const { uploadProduitPhoto } = require('../middleware/upload.middleware');
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const produitsController = require('../controllers/produits.controller');

// Catalogue produits : nom, prix de vente, unite de stock/achat, facteur de conversion
router.get('/', requireAuth, requirePermission('produits', 'voir'), produitsController.list);
router.get('/:id', requireAuth, requirePermission('produits', 'voir'), produitsController.getById);
router.post('/', requireAuth, requirePermission('produits', 'creer'), produitsController.create);
router.put('/:id', requireAuth, requirePermission('produits', 'modifier'), produitsController.update);
router.patch('/:id/desactiver', requireAuth, requirePermission('produits', 'archiver'), produitsController.desactiver);

// Photo produit : fichier sur disque (uploads/produits/), la fiche ne stocke que le chemin
router.post('/:id/photo', requireAuth, requirePermission('produits', 'modifier'), uploadProduitPhoto.single('photo'), produitsController.uploadPhoto);

// Historique des prix d'un produit
router.get('/:id/historique-prix', requireAuth, requirePermission('produits', 'voir'), produitsController.historiquePrix);

module.exports = router;
