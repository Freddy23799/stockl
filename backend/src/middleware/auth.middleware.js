const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/secret');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentification requise' });
  }
  try {
    const token = header.slice('Bearer '.length);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token invalide ou expire' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Acces refuse' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
