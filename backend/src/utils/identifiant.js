// Construction du nom d'utilisateur a partir du prenom et du nom.
// "Jean-Marie" + "N'Doumbe" -> "jean-marie.ndoumbe"
// Les accents sont retires pour que l'identifiant reste saisissable sur
// n'importe quel clavier, y compris un pave numerique de caisse.

function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // supprime les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')        // tout le reste devient un tiret
    .replace(/^-+|-+$/g, '');           // pas de tiret en debut/fin
}

function construireBase(prenom, nom) {
  const morceaux = [normaliser(prenom), normaliser(nom)].filter(Boolean);
  return morceaux.join('.');
}

/**
 * Genere un nom d'utilisateur unique. En cas de collision (deux "Jean Dupont"),
 * un suffixe numerique est ajoute : jean.dupont, jean.dupont2, jean.dupont3...
 */
async function genererNomUtilisateurUnique(client, prenom, nom) {
  const base = construireBase(prenom, nom);
  if (!base) {
    throw new Error('Le prenom et le nom ne permettent pas de construire un identifiant');
  }

  for (let suffixe = 1; suffixe <= 100; suffixe += 1) {
    const candidat = suffixe === 1 ? base : `${base}${suffixe}`;
    const { rows } = await client.query(
      'SELECT 1 FROM utilisateurs WHERE nom_utilisateur = $1',
      [candidat]
    );
    if (rows.length === 0) return candidat;
  }

  throw new Error(`Impossible de generer un identifiant unique pour "${base}"`);
}

module.exports = { normaliser, construireBase, genererNomUtilisateurUnique };
