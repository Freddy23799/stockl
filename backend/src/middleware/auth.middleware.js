const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config');
const pool = require('../config/db');

// La signature du jeton ne suffit pas : un JWT reste valable jusqu'a son
// expiration meme si, entre-temps, le compte a ete desactive ou le mot de passe
// change. On revalide donc l'etat du compte a chaque requete authentifiee.
//
// Cout : une requete indexee sur cle primaire par appel. Negligeable ici, et
// c'est le prix d'une revocation immediate plutot qu'au bout de 12 h.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentification requise' });
  }

  let payload;
  try {
    payload = jwt.verify(header.slice('Bearer '.length), jwtSecret);
  } catch (err) {
    return res.status(401).json({ message: 'Token invalide ou expire' });
  }

  const { rows } = await pool.query(
    `SELECT u.actif, u.tokens_invalides_avant, u.entreprise_id, e.actif AS entreprise_actif
       FROM utilisateurs u
       LEFT JOIN entreprises e ON e.id = u.entreprise_id
      WHERE u.id = $1`,
    [payload.id]
  );
  const compte = rows[0];

  if (!compte || !compte.actif) {
    return res.status(401).json({ message: 'Compte introuvable ou desactive' });
  }

  // Desactiver une entreprise doit fermer immediatement l'acces de tous ses
  // comptes, meme ceux dont le jeton est encore dans sa fenetre de validite -
  // meme logique que la desactivation d'un compte individuel ci-dessus.
  if (compte.entreprise_id && compte.entreprise_actif === false) {
    return res.status(401).json({ message: 'Entreprise desactivee' });
  }

  // `iat` est en secondes depuis l'epoque ; la colonne est tronquee a la seconde
  // pour que le jeton emis au moment meme du changement reste valable.
  const seuil = compte.tokens_invalides_avant;
  if (seuil && payload.iat * 1000 < seuil.getTime()) {
    return res.status(401).json({
      message: 'Session invalidee, veuillez vous reconnecter',
      code: 'SESSION_INVALIDEE',
    });
  }

  req.user = payload;
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Acces refuse' });
    }
    next();
  };
}

// Reserve aux comptes operateur (exploitant de la plateforme), voir migration
// 029. Un compte operateur n'a pas d'entreprise (entrepriseId null dans le
// jeton) : c'est le role qui fait autorite ici, pas requireRole('operateur')
// seul, pour rendre l'intention explicite sur les routes de gestion des
// entreprises clientes.
function requireOperateurPlateforme(req, res, next) {
  if (!req.user || req.user.role !== 'operateur') {
    return res.status(403).json({ message: 'Reserve a l\'operateur de la plateforme' });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireOperateurPlateforme };
