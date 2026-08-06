const pool = require('../config/db');

const COLONNE_PAR_MODULE = {
  ventes: 'module_ventes',
  fournisseurs: 'module_fournisseurs',
  depenses: 'module_depenses',
  employes: 'module_employes',
  paie: 'module_paie',
  badges: 'module_badges',
};

// Blocage reel cote backend : un module desactive rejette la requete meme si
// elle est appelee directement (pas seulement cache dans l'interface). Lit la
// base a chaque requete (pas de cache) pour qu'une desactivation prenne effet
// immediatement, sans attendre l'expiration d'un cache ou un redemarrage.
function requireModule(nom) {
  const colonne = COLONNE_PAR_MODULE[nom];
  if (!colonne) throw new Error(`Module inconnu: ${nom}`);

  return async (req, res, next) => {
    const { rows } = await pool.query(`SELECT ${colonne} AS actif FROM parametres WHERE id = 1`);
    if (!rows[0]?.actif) {
      return res.status(403).json({ message: `Le module "${nom}" est desactive`, code: 'MODULE_DESACTIVE', module: nom });
    }
    next();
  };
}

module.exports = { requireModule };
