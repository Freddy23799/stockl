const path = require('path');
const multer = require('multer');

const config = require('../config');

// Photos produits : ecrites directement sur disque dans uploads/produits/.
// La fiche produit ne stocke que le nom de fichier (colonne texte), jamais le BLOB.
const storage = multer.diskStorage({
  destination: path.join(config.uploadsDir, 'produits'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const productId = req.params.id || Date.now();
    cb(null, `${productId}${ext}`);
  },
});

const uploadProduitPhoto = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// Logo boutique : ecrit dans uploads/logo/, un seul fichier actif a la fois
// (nom fixe -> le nouvel upload remplace l'ancien). Reutilise en en-tete de
// tous les documents generes (rapports, exports).
const logoStorage = multer.diskStorage({
  destination: path.join(config.uploadsDir, 'logo'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo-machibel${ext}`);
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

module.exports = { uploadProduitPhoto, uploadLogo };
