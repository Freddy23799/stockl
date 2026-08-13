// Code a 6 chiffres identifiant une vendeuse au comptoir.
//
// Extrait de vendeuses.controller.js pour etre reutilisable depuis
// utilisateurs.controller.js (creation d'un compte de connexion vendeuse, qui
// cree-ou-lie la meme fiche vendeuse).

function genererCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Le code identifie une vendeuse de facon permanente - il n'est jamais
// reattribue ni modifie apres creation (sauf regeneration explicite).
async function genererCodeUnique(client) {
  for (let tentative = 0; tentative < 20; tentative += 1) {
    const code = genererCode();
    const { rows } = await client.query('SELECT 1 FROM vendeuses WHERE code = $1', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Impossible de generer un code vendeuse unique');
}

module.exports = { genererCodeUnique };
