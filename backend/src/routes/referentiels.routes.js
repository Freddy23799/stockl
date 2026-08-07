const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { categories, marques } = require('../controllers/referentiel.controller');

// Categories (rayons) et marques des produits.
//
// La lecture est ouverte a tout compte connecte : l'ecran de vente s'en sert
// pour filtrer les cartes. L'ecriture reste reservee a l'administration, comme
// pour le catalogue lui-meme.
function routeur(controleur) {
  const router = express.Router();
  router.get('/', requireAuth, controleur.list);
  router.post('/', requireAuth, requireRole('admin'), controleur.create);
  router.put('/:id', requireAuth, requireRole('admin'), controleur.update);
  router.delete('/:id', requireAuth, requireRole('admin'), controleur.supprimer);
  return router;
}

module.exports = { categories: routeur(categories), marques: routeur(marques) };
