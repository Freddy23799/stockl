const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const routes = require('./routes');

const app = express();

// Si un proxy (terminaison TLS de l'hebergeur, Cloudflare...) se trouve devant,
// c'est lui qui porte l'IP source dans X-Forwarded-For. Sans ceci, le limiteur
// de tentatives de connexion compterait tout le monde ensemble.
app.set('trust proxy', 1);

// Photos produits : fichiers statiques sur disque, la DB ne stocke que le chemin (pas de BLOB)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Le service est expose sur Internet : n'importe quel site ne doit pas pouvoir
// appeler l'API depuis le navigateur d'un utilisateur connecte. Seule l'origine
// de la PWA est acceptee (voir config.originesAutorisees).
// Les requetes sans en-tete Origin (outils en ligne de commande, sonde de sante)
// ne sont pas concernees par CORS et restent acceptees.
// Une origine non autorisee ne recoit simplement pas les en-tetes CORS : c'est
// le navigateur qui bloque la lecture de la reponse. On ne leve pas d'erreur,
// sinon chaque scan automatise remplirait le journal de 500.
app.use(cors({
  origin(origine, callback) {
    callback(null, !origine || config.originesAutorisees.includes(origine));
  },
}));
app.use(morgan(config.estProduction ? 'combined' : 'dev'));
app.use(express.json());
app.use('/uploads', express.static(config.uploadsDir));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

// -----------------------------------------------------------------------------
// PWA servie par ce meme processus : un seul service a deployer, une seule
// origine, donc pas de CORS a gerer entre le front et l'API.
// Le build (frontend/dist) peut etre absent en developpement : dans ce cas Vite
// sert le front de son cote et on ne monte rien ici.
// -----------------------------------------------------------------------------
const indexHtml = path.join(config.frontendDir, 'index.html');

if (fs.existsSync(indexHtml)) {
  app.use(express.static(config.frontendDir, {
    // Les noms de fichiers generes par Vite contiennent un hash : ils peuvent
    // etre caches indefiniment. index.html et le service worker, non - sinon un
    // navigateur reste bloque sur l'ancienne version apres un deploiement.
    setHeaders(res, chemin) {
      const nom = path.basename(chemin);
      if (nom === 'index.html' || nom === 'sw.js' || nom === 'registerSW.js') {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  }));

  // Toute route inconnue qui n'est pas de l'API rend la PWA : c'est vue-router
  // qui decide quoi afficher (rechargement direct sur /ventes, /stock, etc.).
  app.get(/^(?!\/api\/|\/uploads\/|\/health$).*/, (req, res) => res.sendFile(indexHtml));
}

app.use((req, res) => res.status(404).json({ message: 'Route inconnue' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Erreur serveur' });
});

module.exports = app;
