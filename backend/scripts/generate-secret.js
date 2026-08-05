// Genere un secret JWT robuste a coller dans .env (JWT_SECRET=...).
// Usage: node scripts/generate-secret.js
const crypto = require('crypto');
console.log(crypto.randomBytes(64).toString('hex'));
