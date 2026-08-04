const rateLimit = require('express-rate-limit');

// Protege /auth/login contre le brute-force du mot de passe admin.
// 10 tentatives / 15 min / IP : large pour un usage normal, serre pour un bot.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de tentatives de connexion. Reessayez dans quelques minutes.' },
  skipSuccessfulRequests: true,
});

module.exports = { loginLimiter };
