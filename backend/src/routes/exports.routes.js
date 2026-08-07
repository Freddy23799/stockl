const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const exportsController = require('../controllers/exports.controller');
const exportsRh = require('../controllers/exports-rh.controller');
const facturesController = require('../controllers/factures.controller');

// Un document imprime sort autant de donnees qu'un ecran entier : il est soumis
// aux memes controles d'acces, module par module.
router.use(requireAuth, requireRole('admin'));

router.get('/synthese.pdf', exportsController.synthese);
router.get('/ventes.pdf', requireModule('ventes'), exportsController.ventes);
router.get('/stock.pdf', exportsController.stock);
router.get('/produits.pdf', exportsController.produits);
router.get('/depenses.pdf', requireModule('depenses'), exportsController.depenses);
router.get('/mouvements.pdf', exportsController.mouvements);
router.get('/historique.pdf', exportsController.historique);

// Facture d'une vente. Rattachee au module Ventes et non a la sous-option de
// facturation : une facture deja emise doit rester reeditable meme si la
// facturation a ete desactivee depuis, sinon un client qui reclame son
// duplicata reste sans reponse.
router.get('/factures/:id.pdf', requireModule('ventes'), facturesController.facture);

// Documents du personnel : chacun est rattache au module qui le produit, pour
// qu'eteindre "Paie" ferme aussi la porte de derriere qu'est l'export.
router.get('/badges.pdf', requireModule('badges'), exportsRh.badges);
router.get('/employes.pdf', requireModule('employes'), exportsRh.employes);
router.get('/recus/:numero.pdf', requireModule('paie'), exportsRh.recu);
router.get('/statistiques-paie.pdf', requireModule('paie'), exportsRh.statistiquesPaie);

// Verification d'un code scanne. Volontairement hors module : on doit pouvoir
// controler l'authenticite d'un badge ou d'un recu meme si le module qui l'a
// produit a ete desactive depuis.
router.post('/verifier', exportsRh.verifier);

module.exports = router;
