import { formatMontant, formatQuantite, formatDate } from './format'

// -----------------------------------------------------------------------------
// Lecture du journal d'audit.
//
// Le journal stocke des identifiants techniques et des objets JSON. L'ecran doit
// parler francais a un commercant, pas a un developpeur : ce module traduit une
// ligne brute en quelque chose qui se lit.
//
// Il tolere deux formes de `details`, parce que les deux coexistent en base :
//   - la forme historique : un objet plat, ecrit avant que l'audit ne capture
//     l'etat anterieur ;
//   - la forme versionnee : { v: 1, resume, avant, apres }.
// Rien n'a ete reecrit en base : c'est ici que la difference se resout.
// -----------------------------------------------------------------------------

/* --- Types d'operation ---------------------------------------------------- */

export const OPERATIONS = {
  produit_creation: { libelle: 'Produit cree', ton: 'success', icone: 'package', entite: 'produit' },
  produit_modification: { libelle: 'Produit modifie', ton: 'warning', icone: 'edit', entite: 'produit' },
  produit_changement_prix: { libelle: 'Prix de vente change', ton: 'warning', icone: 'tag', entite: 'produit' },
  produit_desactivation: { libelle: 'Produit archive', ton: 'danger', icone: 'inbox', entite: 'produit' },
  vendeuse_creation: { libelle: 'Vendeuse creee', ton: 'success', icone: 'userPlus', entite: 'vendeuse' },
  vendeuse_activation: { libelle: 'Vendeuse reactivee', ton: 'success', icone: 'toggle', entite: 'vendeuse' },
  vendeuse_desactivation: { libelle: 'Vendeuse desactivee', ton: 'danger', icone: 'toggle', entite: 'vendeuse' },
  utilisateur_creation: { libelle: 'Compte cree', ton: 'success', icone: 'userPlus', entite: 'compte' },
  utilisateur_desactivation: { libelle: 'Compte bloque', ton: 'danger', icone: 'toggle', entite: 'compte' },
  utilisateur_reactivation: { libelle: 'Compte debloque', ton: 'success', icone: 'check', entite: 'compte' },
  utilisateur_changement_mot_de_passe: { libelle: 'Mot de passe change', ton: 'warning', icone: 'key', entite: 'compte' },
  admin_initial_cree: { libelle: 'Compte administrateur initial', ton: 'info', icone: 'shield', entite: 'compte' },
  vente_creation: { libelle: 'Vente enregistree', ton: 'success', icone: 'cart', entite: 'vente' },
  entree_stock: { libelle: 'Entree de stock', ton: 'success', icone: 'boxIn', entite: 'produit' },
  ajustement_stock: { libelle: 'Ajustement de stock', ton: 'warning', icone: 'clipboard', entite: 'produit' },
  vendeuse_code_regenere: { libelle: 'Code vendeuse regenere', ton: 'warning', icone: 'refresh', entite: 'vendeuse' },
  depense_creation: { libelle: 'Depense enregistree', ton: 'success', icone: 'wallet', entite: 'depense' },
  fournisseur_creation: { libelle: 'Fournisseur cree', ton: 'success', icone: 'truck', entite: 'fournisseur' },
  fournisseur_activation: { libelle: 'Fournisseur reactive', ton: 'success', icone: 'toggle', entite: 'fournisseur' },
  fournisseur_desactivation: { libelle: 'Fournisseur desactive', ton: 'danger', icone: 'toggle', entite: 'fournisseur' },
  parametres_modification: { libelle: 'Parametres modifies', ton: 'warning', icone: 'settings', entite: 'parametres' },
  parametres_logo_modifie: { libelle: 'Logo modifie', ton: 'warning', icone: 'image', entite: 'parametres' },
  etablissement_modification: { libelle: "Identite de l'etablissement modifiee", ton: 'warning', icone: 'building', entite: 'parametres' },
}

// Un type ajoute cote serveur apres ce build reste lisible : on deduit la
// famille du suffixe plutot que d'afficher un badge muet.
export function decrire(type) {
  const connu = OPERATIONS[type]
  if (connu) return connu
  const t = String(type || '')
  const libelle = t.replace(/_/g, ' ')
  if (/desactivation|suppression|blocage/.test(t)) return { libelle, ton: 'danger', icone: 'trash' }
  if (/creation|activation|entree/.test(t)) return { libelle, ton: 'success', icone: 'check' }
  if (/modification|changement/.test(t)) return { libelle, ton: 'warning', icone: 'edit' }
  return { libelle, ton: '', icone: 'info' }
}

/* --- Champs --------------------------------------------------------------- */

const MONTANT = (v) => formatMontant(v)
const QUANTITE = (v) => formatQuantite(v)
const BOOLEEN = (v) => (v ? 'oui' : 'non')

// Libelles et mises en forme des champs journalises. Ce qui n'est pas liste
// reste affiche, avec son nom rendu lisible : mieux vaut un intitule imparfait
// qu'une information cachee.
const CHAMPS = {
  nom: { label: 'Nom' },
  prenom: { label: 'Prenom' },
  nom_utilisateur: { label: 'Identifiant de connexion' },
  prix_vente: { label: 'Prix de vente', format: MONTANT },
  ancien_prix: { label: 'Ancien prix', format: MONTANT },
  nouveau_prix: { label: 'Nouveau prix', format: MONTANT },
  unite_stock: { label: 'Unite de stock' },
  unite_achat: { label: "Unite d'achat" },
  facteur_conversion: { label: 'Facteur de conversion', format: QUANTITE },
  seuil_alerte: { label: "Seuil d'alerte", format: QUANTITE },
  quantite_stock: { label: 'Quantite en stock', format: QUANTITE },
  quantite: { label: 'Quantite', format: QUANTITE },
  quantite_achat: { label: 'Quantite achetee', format: QUANTITE },
  cout_moyen_pondere: { label: 'Cout moyen pondere', format: MONTANT },
  cout_unitaire: { label: 'Cout unitaire', format: MONTANT },
  cout_achat_total: { label: "Cout total d'achat", format: MONTANT },
  montant: { label: 'Montant', format: MONTANT },
  montant_total: { label: 'Montant total', format: MONTANT },
  actif: { label: 'Actif', format: BOOLEEN },
  photo: { label: 'Photo' },
  categorie: { label: 'Categorie' },
  note: { label: 'Note' },
  code: { label: 'Code' },
  contact: { label: 'Contact' },
  type: { label: 'Type' },
  produit_nom: { label: 'Produit' },
  vendeuse_nom: { label: 'Vendeuse' },
  fournisseur_nom: { label: 'Fournisseur' },
  utilisateur_nom: { label: 'Utilisateur' },
  methode_valorisation: { label: 'Methode de valorisation' },
  logo_path: { label: 'Fichier du logo' },
  devise: { label: 'Devise' },
  module_ventes: { label: 'Module Ventes', format: BOOLEEN },
  module_fournisseurs: { label: 'Module Fournisseurs', format: BOOLEEN },
  module_depenses: { label: 'Module Depenses', format: BOOLEEN },
  champs_modifies: { label: 'Champs modifies' },
  motif: { label: 'Motif' },
  ecart: { label: 'Ecart constate', format: QUANTITE },
  valeur_ecart: { label: "Valeur de l'ecart", format: MONTANT },
  etablissement_nom: { label: "Nom de l'etablissement" },
  etablissement_slogan: { label: 'Slogan' },
  etablissement_activite: { label: "Secteur d'activite" },
  etablissement_adresse: { label: 'Adresse' },
  etablissement_quartier: { label: 'Quartier' },
  etablissement_ville: { label: 'Ville' },
  etablissement_pays: { label: 'Pays' },
  etablissement_boite_postale: { label: 'Boite postale' },
  etablissement_telephone: { label: 'Telephone principal' },
  etablissement_telephone_2: { label: 'Telephone secondaire' },
  etablissement_email: { label: 'Adresse email' },
  etablissement_site_web: { label: 'Site web' },
  etablissement_registre_commerce: { label: 'Registre du commerce' },
  etablissement_identifiant_fiscal: { label: 'Identifiant fiscal' },
  etablissement_capital: { label: 'Capital social' },
  etablissement_mention_pied: { label: 'Mention de bas de page' },
}

export function libelleChamp(cle) {
  return CHAMPS[cle]?.label || String(cle).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export function valeurChamp(cle, valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return '—'
  if (typeof valeur === 'boolean') return BOOLEEN(valeur)
  if (typeof valeur === 'object') {
    return Array.isArray(valeur) ? `${valeur.length} element(s)` : 'donnees detaillees'
  }
  const format = CHAMPS[cle]?.format
  if (format) return format(valeur)
  // Un horodatage ISO ne se lit pas ; tout le reste est rendu tel quel.
  if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valeur)) return formatDate(valeur)
  return String(valeur)
}

/* --- Lecture d'une ligne -------------------------------------------------- */

// Separe les trois parties, quelle que soit la forme enregistree.
export function partiesDetails(details) {
  if (!details || typeof details !== 'object') {
    return { resume: {}, avant: null, apres: null, ancienneForme: false }
  }
  // La forme versionnee se reconnait a son champ `v`.
  if (details.v) {
    return {
      resume: details.resume || {},
      avant: details.avant || null,
      apres: details.apres || null,
      ancienneForme: false,
    }
  }
  // Forme historique : tout est au meme niveau, et il n'y a pas d'etat anterieur.
  return { resume: details, avant: null, apres: null, ancienneForme: true }
}

const VIDE = '—'

/**
 * Vrai si la trace porte un etat anterieur, donc s'il y a quelque chose a
 * comparer. Une creation n'en a pas : afficher pour elle une colonne "Avant"
 * entierement vide laisserait croire que des valeurs ont ete effacees.
 */
export function aEtatAnterieur(details) {
  return Boolean(partiesDetails(details).avant)
}

/**
 * Champs ayant reellement change, pour le tableau avant/apres.
 * Ne retient que les differences : afficher trente lignes identiques noierait
 * la seule qui compte.
 */
export function changements(details) {
  const { avant, apres } = partiesDetails(details)
  if (!avant && !apres) return []

  const cles = new Set([...Object.keys(avant || {}), ...Object.keys(apres || {})])
  const lignes = []
  for (const cle of cles) {
    // Comparaison sur la valeur affichee : sinon 12 et "12.00" passent pour
    // deux valeurs differentes alors que la fiche n'a pas bouge.
    const rendu = (v) => valeurChamp(cle, v)
    const valeurAvant = avant ? rendu(avant[cle]) : null
    const valeurApres = apres ? rendu(apres[cle]) : null

    if (avant && apres && valeurAvant === valeurApres) continue
    // Un champ vide des deux cotes n'apprend rien : il occupait une ligne
    // entiere pour afficher deux tirets.
    if ((valeurAvant ?? VIDE) === VIDE && (valeurApres ?? VIDE) === VIDE) continue

    lignes.push({ cle, label: libelleChamp(cle), avant: valeurAvant, apres: valeurApres })
  }
  return lignes.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}

/**
 * Valeurs a afficher pour une operation sans etat anterieur (creation).
 * Fusionne le resume et l'etat d'arrivee, en evitant les doublons : les deux se
 * recoupent souvent, et repeter deux fois le montant d'une depense fait douter
 * de ce qu'on lit.
 */
export function valeursEnregistrees(details) {
  const { resume, apres } = partiesDetails(details)
  const fusion = { ...(apres || {}), ...(resume || {}) }
  const lignes = []
  for (const [cle, valeur] of Object.entries(fusion)) {
    if (typeof valeur === 'object' && valeur !== null) continue
    const rendu = valeurChamp(cle, valeur)
    if (rendu === VIDE) continue
    lignes.push({ cle, label: libelleChamp(cle), valeur: rendu })
  }
  return lignes.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}

/** Champs du resume, pour la ligne du tableau et l'entete du detail. */
export function resumeLisible(details, limite = 3) {
  const { resume } = partiesDetails(details)
  const lignes = []
  for (const [cle, valeur] of Object.entries(resume || {})) {
    if (valeur === null || valeur === undefined || typeof valeur === 'object') continue
    lignes.push({ cle, label: libelleChamp(cle), valeur: valeurChamp(cle, valeur) })
    if (lignes.length >= limite) break
  }
  return lignes
}

/* --- Consequences --------------------------------------------------------- */

// Une phrase en francais qui dit ce que l'operation a change dans le systeme.
// Une fonction par famille plutot qu'un grand `if` : chaque cas reste lisible
// et peut etre complete sans toucher aux autres.
const CONSEQUENCES = {
  produit_creation: ({ resume }) =>
    `« ${resume.nom || 'Ce produit'} » entre au catalogue. Il devient disponible a la caisse `
    + "et dans les entrees de stock, avec une quantite initiale de zero.",

  produit_changement_prix: ({ avant, apres, resume }) => {
    const ancien = avant?.prix_vente ?? resume.ancien_prix
    const nouveau = apres?.prix_vente ?? resume.nouveau_prix
    if (ancien === undefined || nouveau === undefined) {
      return "Le prix de vente a change. Les ventes deja enregistrees gardent le prix applique au moment ou elles ont eu lieu."
    }
    const sens = Number(nouveau) > Number(ancien) ? 'augmente' : 'baisse'
    return `Le prix ${sens} de ${formatMontant(ancien)} a ${formatMontant(nouveau)}. `
      + 'Les ventes deja enregistrees ne sont pas recalculees : chacune garde le prix applique au moment ou elle a eu lieu.'
  },

  produit_desactivation: ({ resume }) =>
    `« ${resume.nom || 'Ce produit'} » n'apparait plus au catalogue ni a la caisse. `
    + "Son historique de ventes et ses mouvements de stock sont conserves : les rapports passes restent justes.",

  entree_stock: ({ avant, apres, resume }) => {
    const nom = resume.produit_nom || 'Ce produit'
    if (avant?.quantite_stock !== undefined && apres?.quantite_stock !== undefined) {
      const unite = apres.unite_stock || avant.unite_stock || ''
      const phrase = `Le stock de ${nom} passe de ${formatQuantite(avant.quantite_stock)} `
        + `a ${formatQuantite(apres.quantite_stock)} ${unite}.`.trim()
      if (avant.cout_moyen_pondere !== undefined && apres.cout_moyen_pondere !== undefined
        && String(avant.cout_moyen_pondere) !== String(apres.cout_moyen_pondere)) {
        return `${phrase} Le cout moyen pondere passe de ${formatMontant(avant.cout_moyen_pondere)} `
          + `a ${formatMontant(apres.cout_moyen_pondere)}, ce qui modifie la marge calculee sur les ventes a venir.`
      }
      return phrase
    }
    return `Un lot est entre en stock pour ${nom}.`
  },

  ajustement_stock: ({ resume, avant, apres }) => {
    const nom = resume.produit_nom || 'Ce produit'
    const unite = apres?.unite_stock || avant?.unite_stock || ''
    const libelles = {
      inventaire: 'un comptage des rayons',
      casse: 'de la casse',
      perte: 'une perte',
      vol: 'un vol constate',
      retour_client: 'un retour client',
      correction: 'une correction de saisie',
    }
    const cause = libelles[resume.motif] || 'un ajustement'
    const base = avant?.quantite_stock !== undefined && apres?.quantite_stock !== undefined
      ? `Le stock de ${nom} passe de ${formatQuantite(avant.quantite_stock)} a `
        + `${formatQuantite(apres.quantite_stock)} ${unite}`.trim()
      : `Le stock de ${nom} a ete ajuste`
    const valeur = resume.valeur_ecart
      ? ` Valeur concernee : ${formatMontant(resume.valeur_ecart)}.`
      : ''
    return `${base}, apres ${cause}.${valeur} Ce mouvement n'entre pas dans le chiffre d'affaires : `
      + "il corrige le stock sans creer de vente."
  },

  vendeuse_code_regenere: ({ resume }) =>
    `Le code de ${resume.vendeuse_nom || 'cette vendeuse'} a ete remplace. L'ancien est refuse `
    + "immediatement a la caisse ; les ventes deja enregistrees a son nom ne sont pas touchees. "
    + "L'ancien code n'est volontairement pas conserve dans ce journal.",

  vente_creation: ({ resume }) => {
    const montant = resume.montant_total !== undefined ? formatMontant(resume.montant_total) : null
    const canal = resume.type === 'vendeuse' ? 'attribuee a une vendeuse' : 'encaissee en boutique'
    return `Vente ${canal}${montant ? ` pour ${montant}` : ''}. Le stock des produits vendus a ete `
      + 'decremente immediatement, et le cout d\'acquisition a ete fige sur chaque ligne.'
  },

  depense_creation: ({ resume }) => {
    const montant = resume.montant !== undefined ? formatMontant(resume.montant) : 'Cette depense'
    return `${montant} vient en deduction du bilan net de la periode concernee.`
  },

  utilisateur_creation: ({ resume }) =>
    `Un compte administrateur a ete cree avec l'identifiant « ${resume.nom_utilisateur || '?'} ». `
    + "Son mot de passe initial a ete affiche une seule fois, a la creation, et n'est plus recuperable.",

  utilisateur_desactivation: () =>
    'Ce compte ne peut plus se connecter, et ses sessions ouvertes ailleurs ont ete coupees '
    + "immediatement. Le compte n'est pas supprime : les operations qu'il a realisees restent tracees a son nom.",

  utilisateur_reactivation: () =>
    'Ce compte peut de nouveau se connecter, avec le mot de passe qu\'il avait avant le blocage.',

  utilisateur_changement_mot_de_passe: () =>
    'Toutes les sessions ouvertes sur les autres postes ont ete invalidees. '
    + 'Le mot de passe lui-meme n\'est jamais enregistre dans ce journal.',

  vendeuse_desactivation: ({ resume }) =>
    `Le code de ${resume.nom || 'cette vendeuse'} n'est plus accepte a la caisse. `
    + 'Ses ventes passees restent comptabilisees dans les rapports.',

  vendeuse_activation: ({ resume }) =>
    `Le code de ${resume.nom || 'cette vendeuse'} est de nouveau accepte a la caisse.`,

  fournisseur_desactivation: ({ resume }) =>
    `${resume.nom || 'Ce fournisseur'} n'est plus proposable lors d'une entree de stock. `
    + 'Les entrees deja enregistrees a son nom sont conservees.',

  parametres_logo_modifie: () =>
    "Le nouveau logo apparait dans l'application et en entete de tous les documents imprimes.",

  etablissement_modification: ({ changements: lignes }) =>
    `${lignes.length} information(s) de l'etablissement ont change. Elles composent l'entete `
    + 'de tous les rapports PDF : les prochains documents porteront ces valeurs.',

  parametres_modification: ({ avant, apres }) => {
    const modules = ['module_ventes', 'module_fournisseurs', 'module_depenses']
      .filter((m) => avant && apres && avant[m] !== apres[m])
    if (modules.length) {
      const eteints = modules.filter((m) => !apres[m]).map((m) => libelleChamp(m))
      const allumes = modules.filter((m) => apres[m]).map((m) => libelleChamp(m))
      const morceaux = []
      if (eteints.length) morceaux.push(`${eteints.join(', ')} : les pages correspondantes disparaissent du menu et les appels sont refuses cote serveur`)
      if (allumes.length) morceaux.push(`${allumes.join(', ')} : les pages redeviennent accessibles`)
      return `${morceaux.join('. ')}. Aucune donnee n'est effacee : tout revient a la reactivation.`
    }
    if (avant && apres && avant.methode_valorisation !== apres.methode_valorisation) {
      return `La valorisation du stock passe de ${avant.methode_valorisation} a ${apres.methode_valorisation}. `
        + 'Les ventes deja enregistrees gardent le cout fige au moment de la vente ; seules les ventes a venir sont concernees.'
    }
    return 'Un reglage general a change.'
  },
}

/**
 * Phrase decrivant l'effet de l'operation, ou une chaine vide si on ne sait pas
 * en dire quelque chose de sur. Mieux vaut ne rien afficher qu'une banalite.
 */
export function consequence(operation) {
  const fabrique = CONSEQUENCES[operation.type_operation]
  if (!fabrique) return ''
  const { resume, avant, apres } = partiesDetails(operation.details)
  try {
    return fabrique({ resume: resume || {}, avant, apres, changements: changements(operation.details) })
  } catch {
    // Un detail incomplet ne doit jamais empecher d'ouvrir la fiche.
    return ''
  }
}

/* --- Dates ---------------------------------------------------------------- */

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']

export function dateEnToutesLettres(valeur) {
  if (!valeur) return ''
  const d = new Date(valeur)
  if (Number.isNaN(d.getTime())) return ''
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()} a ${h}:${m}:${s}`
}

// "il y a 2 heures" situe l'operation bien plus vite qu'une date absolue.
export function tempsRelatif(valeur) {
  if (!valeur) return ''
  const d = new Date(valeur)
  if (Number.isNaN(d.getTime())) return ''
  const secondes = Math.round((Date.now() - d.getTime()) / 1000)
  if (secondes < 0) return "a l'instant"
  if (secondes < 60) return "il y a moins d'une minute"
  const minutes = Math.round(secondes / 60)
  if (minutes < 60) return `il y a ${minutes} minute${minutes > 1 ? 's' : ''}`
  const heures = Math.round(minutes / 60)
  if (heures < 24) return `il y a ${heures} heure${heures > 1 ? 's' : ''}`
  const jours = Math.round(heures / 24)
  if (jours < 31) return `il y a ${jours} jour${jours > 1 ? 's' : ''}`
  const mois = Math.round(jours / 30)
  if (mois < 12) return `il y a ${mois} mois`
  const annees = Math.round(mois / 12)
  return `il y a ${annees} an${annees > 1 ? 's' : ''}`
}
