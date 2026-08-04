const crypto = require('crypto');

const VALEURS_FAIBLES = new Set(['change-me-in-production', 'dev-secret', 'secret', '']);

function resoudreJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const estFaible = !secret || VALEURS_FAIBLES.has(secret);

  if (estFaible) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET manquant ou laisse a sa valeur par defaut en production. ' +
        'Generez-en un avec: node scripts/generate-secret.js, puis mettez-le dans .env'
      );
    }
    console.warn(
      '\n\x1b[33m[ATTENTION]\x1b[0m JWT_SECRET absent ou faible - un secret temporaire ' +
      'a ete genere pour cette session (tous les tokens seront invalides au prochain ' +
      'redemarrage). Definissez JWT_SECRET dans .env avant la production.\n'
    );
    return crypto.randomBytes(64).toString('hex');
  }

  return secret;
}

const JWT_SECRET = resoudreJwtSecret();

module.exports = { JWT_SECRET };
