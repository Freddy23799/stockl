// -----------------------------------------------------------------------------
// Journal d'audit.
//
// Une ligne d'historique doit pouvoir etre relue des annees plus tard, quand la
// donnee d'origine a change ou disparu. Elle porte donc trois choses :
//   - `resume` : ce qui identifie l'operation en clair (le nom du produit, pas
//                seulement son identifiant - un `produit_id: 42` seul est
//                illisible une fois la fiche archivee) ;
//   - `avant`  : l'etat de la ligne AVANT modification, lu dans la meme
//                transaction ;
//   - `apres`  : l'etat apres.
//
// La charge est versionnee (`v`) parce que les milliers de lignes deja ecrites
// n'ont pas cette forme : elles contiennent un objet plat, sans `v`. Le lecteur
// (HistoriqueView) distingue les deux sur ce seul champ. Aucune reecriture de
// l'existant n'est necessaire.
// -----------------------------------------------------------------------------

const VERSION_DETAILS = 1;

// Liste noire des champs qui ne doivent JAMAIS entrer dans le journal.
// Noire et non blanche : les objets journalises sont souvent des lignes de base
// entieres (`SELECT *`), donc une colonne ajoutee demain arriverait
// automatiquement dans l'audit. Mieux vaut qu'une colonne anodine passe par
// erreur qu'un secret. Le motif s'applique au NOM du champ, a n'importe quelle
// profondeur.
const MOTIF_CHAMP_SENSIBLE = /(password|mot_de_passe|motdepasse|hash|secret|token|jwt)/i;

// Un audit se lit a l'ecran : une vente de 40 lignes n'a pas sa place en entier
// dans le journal. On garde un resume exploitable, pas une copie de la base.
const MAX_CHAMPS = 30;
const MAX_ELEMENTS_LISTE = 8;
const MAX_LONGUEUR_TEXTE = 240;
const PROFONDEUR_MAX = 2;

function tronquer(texte) {
  return texte.length > MAX_LONGUEUR_TEXTE ? `${texte.slice(0, MAX_LONGUEUR_TEXTE)}...` : texte;
}

function assainirValeur(valeur, profondeur) {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) return valeur.toISOString();
  const type = typeof valeur;
  if (type === 'string') return tronquer(valeur);
  if (type === 'number') return Number.isFinite(valeur) ? valeur : null;
  if (type === 'boolean') return valeur;
  if (Array.isArray(valeur)) {
    if (profondeur >= PROFONDEUR_MAX) return `${valeur.length} element(s)`;
    return valeur.slice(0, MAX_ELEMENTS_LISTE).map((v) => assainirValeur(v, profondeur + 1));
  }
  if (type === 'object') {
    if (profondeur >= PROFONDEUR_MAX) return '(objet)';
    return assainirObjet(valeur, profondeur + 1);
  }
  // Fonction, symbole, bigint : rien de tout cela n'a de sens dans un journal.
  return null;
}

function assainirObjet(objet, profondeur = 0) {
  if (!objet || typeof objet !== 'object' || Array.isArray(objet)) return null;
  const propre = {};
  let retenus = 0;
  for (const [cle, valeur] of Object.entries(objet)) {
    if (retenus >= MAX_CHAMPS) break;
    if (MOTIF_CHAMP_SENSIBLE.test(cle)) continue;
    if (valeur === undefined) continue;
    propre[cle] = assainirValeur(valeur, profondeur);
    retenus += 1;
  }
  return retenus === 0 ? null : propre;
}

function construireCharge({ details, avant, apres }) {
  const resume = assainirObjet(details);
  const etatAvant = assainirObjet(avant);
  const etatApres = assainirObjet(apres);
  if (!resume && !etatAvant && !etatApres) return null;

  const charge = { v: VERSION_DETAILS };
  if (resume) charge.resume = resume;
  if (etatAvant) charge.avant = etatAvant;
  if (etatApres) charge.apres = etatApres;
  return charge;
}

// -----------------------------------------------------------------------------
// Etats deposes par une couche appelante.
//
// Certaines operations sont journalisees par une couche plus profonde que celle
// qui connait l'etat d'avant : `entreeStock` (services/stock.service.js) ecrit
// lui-meme sa ligne d'audit, alors que seul le controleur peut encadrer l'appel
// pour lire le produit avant et apres. Le controleur depose donc l'etat sur la
// transaction ; `logAudit` le ramasse au passage.
//
// La cle est le client pg, c'est-a-dire la transaction en cours. Les clients du
// pool sont recycles d'une requete a l'autre : `preparerAudit` vide donc tout
// depot residuel (une transaction annulee avant son `logAudit` en laisserait un),
// et chaque depot est retire des qu'il est consomme.
// -----------------------------------------------------------------------------

const depotsParTransaction = new WeakMap();

function preparerAudit(client, { typeOperation, avant = null, details = null }) {
  const depots = new Map();
  depots.set(typeOperation, { avant, details, ligneId: null });
  depotsParTransaction.set(client, depots);
}

// `entrepriseId` : NULL pour un evenement de la plateforme elle-meme (hors
// perimetre de toute entreprise cliente - voir migration 030), sinon
// l'entreprise concernee. Les appelants existants ne le passent pas encore
// tous : c'est un chantier en cours, pas un oubli silencieux (voir le plan
// d'architecture multi-entreprise).
async function logAudit(client, { typeOperation, entiteId = null, utilisateurId = null, entrepriseId = null, details = null, avant = null, apres = null }) {
  const depot = depotsParTransaction.get(client)?.get(typeOperation) || null;
  const charge = construireCharge({
    details: { ...(depot?.details || {}), ...(details || {}) },
    avant: avant || depot?.avant || null,
    apres,
  });

  const { rows } = await client.query(
    `INSERT INTO historique_audit (type_operation, entite_id, utilisateur_id, entreprise_id, details)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [typeOperation, entiteId, utilisateurId, entrepriseId, charge ? JSON.stringify(charge) : null]
  );

  if (depot) {
    depot.avant = null;
    depot.ligneId = rows[0].id;
  }
  return rows[0].id;
}

// Complete la ligne ecrite par la couche profonde avec l'etat d'arrivee, que
// l'appelant n'a pu obtenir qu'une fois l'operation terminee. Sans depot
// prealable il n'y a rien a completer : on ne fait rien plutot que de risquer
// d'ecraser la ligne d'une autre operation.
async function completerAudit(client, { typeOperation, apres = null, details = null }) {
  const depot = depotsParTransaction.get(client)?.get(typeOperation);
  if (!depot || !depot.ligneId) return;

  const { rows } = await client.query('SELECT details FROM historique_audit WHERE id = $1', [depot.ligneId]);
  const existant = rows[0]?.details && typeof rows[0].details === 'object' ? rows[0].details : {};
  const complete = {
    ...existant,
    v: VERSION_DETAILS,
    ...(details ? { resume: { ...(existant.resume || {}), ...(assainirObjet(details) || {}) } } : {}),
    ...(assainirObjet(apres) ? { apres: assainirObjet(apres) } : {}),
  };

  await client.query('UPDATE historique_audit SET details = $1 WHERE id = $2', [
    JSON.stringify(complete),
    depot.ligneId,
  ]);
  depotsParTransaction.get(client).delete(typeOperation);
}

module.exports = { logAudit, preparerAudit, completerAudit, VERSION_DETAILS };
