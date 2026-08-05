const path = require('path');

// Charge backend/.env par chemin ABSOLU. Un `dotenv.config()` sans chemin
// resout depuis le repertoire courant : le service Windows (NSSM) ne demarre
// pas forcement avec backend/ comme CWD, et le .env serait alors ignore en
// silence - le backend tomberait sur les valeurs par defaut ci-dessous sans
// jamais lire le vrai mot de passe.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

// -----------------------------------------------------------------------------
// Source unique de la configuration.
//
// REGLE DU PROJET : en production, backend/.env ne contient que DEUX variables,
// DB_PASSWORD et JWT_SECRET. Tout le reste est fige ici, avec les valeurs de la
// production (PostgreSQL natif Windows sur 5432, backend sur 3010).
//
// La machine de dev surcharge ce dont elle a besoin via son propre .env : c'est
// comme ca que DB_PORT passe a 5439 pour taper dans le conteneur Docker.
// -----------------------------------------------------------------------------

// Valeurs de secret vues dans les .env.example et les tutoriels : les refuser
// explicitement evite qu'un JWT_SECRET copie-colle parte en production.
const JWT_SECRETS_REFUSES = new Set([
  'change-me-in-production',
  'dev-secret',
  'secret',
  'changeme',
]);

const JWT_LONGUEUR_MIN = 32;

function obligatoire(nom, aide) {
  const valeur = (process.env[nom] || '').trim();
  if (!valeur) {
    throw new Error(
      `${nom} n'est pas defini.\n` +
      '  -> En local : ajoutez-le dans backend/.env\n' +
      '  -> En ligne : ajoutez-le aux variables d\'environnement du service\n' +
      `  -> ${aide}`
    );
  }
  return valeur;
}

function resoudreJwtSecret() {
  const secret = obligatoire(
    'JWT_SECRET',
    'Generez-en un avec: npm run generate-secret, puis collez-le dans backend/.env'
  );

  if (JWT_SECRETS_REFUSES.has(secret)) {
    throw new Error(
      'JWT_SECRET a garde une valeur d\'exemple.\n' +
      '  -> Generez un vrai secret avec: npm run generate-secret'
    );
  }

  if (secret.length < JWT_LONGUEUR_MIN) {
    throw new Error(
      `JWT_SECRET fait ${secret.length} caracteres, minimum ${JWT_LONGUEUR_MIN}.\n` +
      '  -> Generez-en un avec: npm run generate-secret'
    );
  }

  return secret;
}

// Domaine public de production. Fige ici comme le reste : le changer est un
// changement de code, pas un reglage a faire chez le client.
const DOMAINE_PRODUCTION = 'stock.schoolshub.org';

// Port du serveur de developpement Vite (voir frontend/vite.config.js).
const ORIGINE_DEV = ['http://localhost:5174', 'http://127.0.0.1:5174'];

// Deux facons d'indiquer la base :
//
//  - DATABASE_URL : une seule chaine de connexion. C'est ce que fournissent les
//    hebergeurs gerés (Render, Railway, Heroku...), injectee automatiquement des
//    que la base est rattachee au service. Rien a saisir a la main.
//  - DB_HOST / DB_PORT / DB_USER / DB_NAME / DB_PASSWORD : variables separees,
//    utilisees en developpement local (conteneur Docker).
//
// DATABASE_URL, si presente, l'emporte.

// Le TLS ne se decide pas a l'aveugle : une base geree distante l'exige, une
// base locale (conteneur de dev, reseau interne de l'hebergeur) ne le supporte
// souvent pas et la connexion echoue avec "server does not support SSL".
function resoudreSsl(url) {
  let hote = '';
  let parametres = new URLSearchParams();
  try {
    const analysee = new URL(url);
    hote = analysee.hostname;
    parametres = analysee.searchParams;
  } catch {
    // URL non analysable : on laisse pg s'en plaindre lui-meme, sans TLS.
    return false;
  }

  // Un sslmode explicite dans l'URL fait autorite.
  const sslmode = parametres.get('sslmode');
  if (sslmode === 'disable') return false;
  if (sslmode) return { rejectUnauthorized: false };

  // Base locale : pas de TLS.
  if (['localhost', '127.0.0.1', '::1', ''].includes(hote)) return false;

  // Base distante : TLS, mais le certificat est signe par une autorite interne
  // a l'hebergeur, absente du magasin de certificats de Node.
  return { rejectUnauthorized: false };
}

function resoudreBaseDeDonnees() {
  const url = (process.env.DATABASE_URL || '').trim();

  if (url) {
    return {
      connectionString: url,
      ssl: resoudreSsl(url),
      origine: 'DATABASE_URL',
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'machibel',
    database: process.env.DB_NAME || 'machibel',
    // Pas de valeur par defaut : un mot de passe de repli masquerait une config
    // mal chargee derriere une erreur d'authentification incomprehensible.
    password: obligatoire(
      'DB_PASSWORD',
      'Mot de passe PostgreSQL. Sur un hebergeur gere, definissez plutot DATABASE_URL.'
    ),
    origine: 'DB_*',
  };
}

const config = {
  // Le processus Node sert a la fois l'API et la PWA : un seul port a exposer.
  // L'hebergeur impose son propre port via PORT, il faut l'ecouter tel quel.
  port: Number(process.env.PORT) || 3010,

  domaine: DOMAINE_PRODUCTION,
  urlPublique: `https://${DOMAINE_PRODUCTION}`,

  // Production par defaut : c'est le mode qui doit marcher sans rien configurer.
  // La machine de dev met NODE_ENV=development dans son .env (voir .env.example).
  env: process.env.NODE_ENV || 'production',

  db: resoudreBaseDeDonnees(),

  jwtSecret: resoudreJwtSecret(),

  // Photos produits et logo : chemin absolu, meme raison que pour le .env.
  uploadsDir: path.join(__dirname, '..', '..', 'uploads'),

  // Build de la PWA (frontend/dist), servi directement par Express en production.
  frontendDir: path.join(__dirname, '..', '..', '..', 'frontend', 'dist'),
};

config.estProduction = config.env === 'production';

// En production, la PWA est servie par ce meme processus, sur le meme domaine
// que l'API : aucune requete legitime ne vient d'une autre origine. En dev, Vite
// (5174) et le backend (3010) sont sur des origines differentes, donc il faut
// les ouvrir.
config.originesAutorisees = config.estProduction ? [config.urlPublique] : ORIGINE_DEV;

module.exports = config;
