// Palette des graphiques.
//
// Aucune couleur n'est ecrite en dur : ce sont les variables du systeme de
// design, donc un basculement clair/sombre repeint les courbes sans code
// supplementaire. Les variables CSS fonctionnent telles quelles dans un `fill`
// ou un `stroke` SVG.
//
// L'ordre est fixe et ne tourne jamais : une categorie garde sa teinte quel que
// soit son rang, sinon un filtre qui retire une part repeindrait toutes les
// autres et on croirait lire de nouvelles donnees.
//
// L'ordre choisi eloigne le rouge du vert (teintes les plus proches pour une
// deuteranopie) : accent -> avertissement -> succes -> danger. La lecture ne
// repose de toute facon jamais sur la seule couleur — chaque part porte son
// libelle et son pourcentage.
export const TEINTES_CATEGORIES = [
  'var(--accent)',
  'var(--warning)',
  'var(--success)',
  'var(--danger)',
]

// Au-dela de quatre categories on ne fabrique pas de nouvelles teintes : le
// reste est regroupe dans « Autres », qui porte le neutre.
export const TEINTE_AUTRES = 'var(--n-400)'

export const LIBELLE_AUTRES = 'Autres'

export function teinteCategorie(index) {
  return TEINTES_CATEGORIES[index] ?? TEINTE_AUTRES
}

/**
 * Arrondit un pas d'axe a une valeur "ronde" : 1, 2, 2.5 ou 5 fois une
 * puissance de dix. Une graduation a 3 274 F ne se lit pas ; 5 000 F si.
 */
export function pasArrondi(brut) {
  if (!Number.isFinite(brut) || brut <= 0) return 1
  const exposant = Math.floor(Math.log10(brut))
  const base = 10 ** exposant
  const reste = brut / base
  let facteur
  if (reste <= 1) facteur = 1
  else if (reste <= 2) facteur = 2
  else if (reste <= 2.5) facteur = 2.5
  else if (reste <= 5) facteur = 5
  else facteur = 10
  return facteur * base
}

/**
 * Echelle Y : borne haute arrondie et graduations regulieres.
 * `divisions` est un objectif, pas une garantie — l'arrondi du pas peut donner
 * une graduation de moins, ce qui est preferable a des valeurs illisibles.
 */
export function echelleY(maximum, divisions = 4) {
  if (!Number.isFinite(maximum) || maximum <= 0) {
    return { max: 1, graduations: [0, 1] }
  }
  const pas = pasArrondi(maximum / divisions)
  const max = Math.ceil(maximum / pas) * pas
  const graduations = []
  for (let v = 0; v <= max + pas / 2; v += pas) graduations.push(Number(v.toFixed(6)))
  return { max, graduations }
}
