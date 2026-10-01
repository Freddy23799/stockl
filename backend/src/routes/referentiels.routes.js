const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const { categories, marques } = require('../controllers/referentiel.controller');

// Categories (rayons) et marques des produits.
//
// La lecture est ouverte a tout compte connecte : l'ecran de vente s'en sert
// pour filtrer les cartes. L'ecriture reste reservee a l'administration, comme
// pour le catalogue lui-meme.
function routeur(controleur) {
  const router = express.Router();
  router.get('/', requireAuth, requirePermission('referentiels', 'voir'), controleur.list);
  router.post('/', requireAuth, requirePermission('referentiels', 'creer'), controleur.create);
  router.put('/:id', requireAuth, requirePermission('referentiels', 'modifier'), controleur.update);
  router.delete('/:id', requireAuth, requirePermission('referentiels', 'supprimer'), controleur.supprimer);
  return router;
}

module.exports = { categories: routeur(categories), marques: routeur(marques) };
