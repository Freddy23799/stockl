const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const exportsController = require('../controllers/exports.controller');
const exportsRh = require('../controllers/exports-rh.controller');
const facturesController = require('../controllers/factures.controller');

// Un document imprime sort autant de donnees qu'un ecran entier : il est soumis
// aux memes controles d'acces, module par module. Le role est verifie route par
// route ci-dessous (la comptabilite a acces aux exports de ventes/factures,
// pas au reste).
router.use(requireAuth);

router.get('/synthese.pdf', requireRole('admin'), exportsController.synthese);
router.get('/ventes.pdf', requireRole('admin', 'comptabilite'), requireModule('ventes'), exportsController.ventes);
router.get('/stock.pdf', requireRole('admin'), exportsController.stock);
router.get('/produits.pdf', requireRole('admin'), exportsController.produits);
router.get('/depenses.pdf', requireRole('admin'), requireModule('depenses'), exportsController.depenses);
router.get('/mouvements.pdf', requireRole('admin'), exportsController.mouvements);
router.get('/historique.pdf', requireRole('admin'), exportsController.historique);

// Facture d'une vente. Rattachee au module Ventes et non a la sous-option de
// facturation : une facture deja emise doit rester reeditable meme si la
// facturation a ete desactivee depuis, sinon un client qui reclame son
// duplicata reste sans reponse. Comptabilite y a acces en lecture (rapprochement).
router.get('/factures/:id.pdf', requireRole('admin', 'comptabilite'), requireModule('ventes'), facturesController.facture);

// Documents du personnel : chacun est rattache au module qui le produit, pour
// qu'eteindre "Paie" ferme aussi la porte de derriere qu'est l'export.
router.get('/badges.pdf', requireRole('admin'), requireModule('badges'), exportsRh.badges);
router.get('/employes.pdf', requireRole('admin'), requireModule('employes'), exportsRh.employes);
router.get('/recus/:numero.pdf', requireRole('admin'), requireModule('paie'), exportsRh.recu);
router.get('/statistiques-paie.pdf', requireRole('admin'), requireModule('paie'), exportsRh.statistiquesPaie);

// Verification d'un code scanne. Volontairement hors module et hors role : on
// doit pouvoir controler l'authenticite d'un badge ou d'un recu meme si le
// module qui l'a produit a ete desactive depuis, quel que soit le compte connecte.
router.post('/verifier', exportsRh.verifier);

module.exports = router;
