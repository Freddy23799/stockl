const pool = require('../config/db');

const COLONNE_PAR_MODULE = {
  ventes: 'module_ventes',
  fournisseurs: 'module_fournisseurs',
  depenses: 'module_depenses',
  employes: 'module_employes',
  paie: 'module_paie',
  badges: 'module_badges',
};

// Les interrupteurs sont relus au plus une fois toutes les cinq secondes.
//
// Sans ce cache, CHAQUE requete sur une route rattachee a un module declenchait
// une requete supplementaire en base. Sur un ecran qui en enchaine une dizaine,
// cela doublait le nombre d'allers-retours pour lire une seule ligne qui ne
// change presque jamais.
//
// Cinq secondes est court : une desactivation prend effet le temps de recharger
// une page, ce qui reste immediat a l'usage. Le cache est vide explicitement des
// qu'un module est modifie (voir parametres.controller), donc en pratique la
// bascule est instantanee.
const DUREE_CACHE_MS = 5000;
let cache = null;
let cacheExpire = 0;

async function lireModules() {
  const maintenant = Date.now();
  if (cache && maintenant < cacheExpire) return cache;
  const { rows } = await pool.query('SELECT * FROM parametres WHERE id = 1');
  cache = rows[0] || {};
  cacheExpire = maintenant + DUREE_CACHE_MS;
  return cache;
}

function invaliderCacheModules() {
  cache = null;
  cacheExpire = 0;
}

// Blocage reel cote backend : un module desactive rejette la requete meme si
// elle est appelee directement (pas seulement cache dans l'interface).
function requireModule(nom) {
  const colonne = COLONNE_PAR_MODULE[nom];
  if (!colonne) throw new Error(`Module inconnu: ${nom}`);

  return async (req, res, next) => {
    const parametres = await lireModules();
    if (!parametres[colonne]) {
      return res.status(403).json({ message: `Le module "${nom}" est desactive`, code: 'MODULE_DESACTIVE', module: nom });
    }
    next();
  };
}

module.exports = { requireModule, invaliderCacheModules };
