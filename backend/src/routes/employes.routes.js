const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireModule } = require('../middleware/module.middleware');
const { uploadEmployePhoto, uploadDocumentFichiers, gererErreursUpload } = require('../middleware/upload.middleware');
const employes = require('../controllers/employes.controller');
const documents = require('../controllers/documents.controller');
const fonctions = require('../controllers/fonctions.controller');
const stagiaires = require('../controllers/stagiaires.controller');

router.use(requireAuth, requireRole('admin'), requireModule('employes'));

// Les fonctions sont une reference du module Employes : elles vivent sous la
// meme route, avant `/:id` pour que "fonctions" ne soit pas pris pour un id.
router.get('/fonctions', fonctions.list);
router.post('/fonctions', fonctions.create);
router.put('/fonctions/:id', fonctions.update);
router.delete('/fonctions/:id', fonctions.supprimer);

router.get('/', employes.list);
router.get('/:id', employes.getById);
router.post('/', employes.create);
router.put('/:id', employes.update);
router.patch('/:id/archiver', employes.archiver);
router.patch('/:id/reactiver', employes.reactiver);

// Carriere : ajouter une periode acte un changement, corriger repare une saisie.
router.post('/:id/carriere', employes.ajouterCarriere);
router.put('/:id/carriere/:periodeId', employes.corrigerCarriere);

router.post('/:id/photo', uploadEmployePhoto.single('photo'), employes.uploadPhoto);

// Un document regroupe plusieurs fichiers : d'ou l'envoi multiple.
router.post('/:id/documents', uploadDocumentFichiers, documents.creer);
router.post('/:id/documents/:documentId/fichiers', uploadDocumentFichiers, documents.ajouterFichiers);
router.put('/:id/documents/:documentId', documents.modifier);
router.delete('/:id/documents/:documentId/fichiers/:fichierId', documents.supprimerFichier);
router.delete('/:id/documents/:documentId', documents.supprimer);

// Badge et attestation de stage. Rattaches au module "Badges" (memes cartes
// professionnelles que /exports/badges.pdf) plutot qu'a un nouveau toggle.
router.post('/:id/stagiaire/badge', requireModule('badges'), stagiaires.genererBadge);
router.post('/:id/stagiaire/attestation', requireModule('badges'), stagiaires.genererAttestation);
router.get('/:id/stagiaire/documents', stagiaires.listerDocuments);
router.get('/:id/stagiaire/documents/:documentId/pdf', stagiaires.telechargerDocument);

router.use(gererErreursUpload);

module.exports = router;
