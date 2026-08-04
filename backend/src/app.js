const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const routes = require('./routes');

const app = express();

// En production, nginx tourne sur la meme machine (127.0.0.1) et fait proxy vers
// ce backend : sans ceci, express-rate-limit verrait toujours l'IP de nginx et
// limiterait tout le monde ensemble au lieu de compter par client reel.
app.set('trust proxy', 'loopback');

// Photos produits : fichiers statiques sur disque, la DB ne stocke que le chemin (pas de BLOB)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

app.use((req, res) => res.status(404).json({ message: 'Route inconnue' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Erreur serveur' });
});

module.exports = app;
