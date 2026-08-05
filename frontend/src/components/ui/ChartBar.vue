<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import EmptyState from './EmptyState.vue'
import { TEINTES_CATEGORIES } from './palette'

// Barres, horizontales par defaut.
//
// Pour un classement (meilleurs produits, categories de depenses) l'horizontale
// gagne sur telephone : le libelle se lit a plat a gauche de sa barre, alors
// qu'en vertical il faudrait l'incliner ou le tronquer a trois lettres.
//
// Une seule mesure est representee : toutes les barres portent donc la meme
// teinte. La couleur ne code rien ici, c'est la longueur qui parle.
const props = defineProps({
  data: { type: Array, default: () => [] },
  orientation: { type: String, default: 'horizontal' },
  formatValeur: { type: Function, default: (v) => String(v) },
  couleur: { type: String, default: TEINTES_CATEGORIES[0] },
  hauteurBarre: { type: Number, default: 34 },
  ariaLabel: { type: String, default: '' },
  videTitre: { type: String, default: 'Aucune donnee' },
  videTexte: { type: String, default: '' },
})

const conteneur = ref(null)
const largeur = ref(560)
let observateur = null

onMounted(() => {
  if (!conteneur.value) return
  const mesurer = () => {
    const l = conteneur.value?.clientWidth
    if (l) largeur.value = Math.max(220, l)
  }
  mesurer()
  if (typeof ResizeObserver !== 'undefined') {
    observateur = new ResizeObserver(mesurer)
    observateur.observe(conteneur.value)
  } else {
    window.addEventListener('resize', mesurer)
    observateur = { disconnect: () => window.removeEventListener('resize', mesurer) }
  }
})
onUnmounted(() => observateur?.disconnect())

const horizontal = computed(() => props.orientation !== 'vertical')

const entrees = computed(() =>
  props.data.filter((d) => d && Number.isFinite(Number(d.valeur)))
)

const vide = computed(() => !entrees.value.length || !entrees.value.some((d) => Number(d.valeur) > 0))

const maximum = computed(() => entrees.value.reduce((m, d) => Math.max(m, Number(d.valeur)), 0) || 1)

/* --- Horizontal ----------------------------------------------------------- */

// Gouttiere du libelle : proportionnelle mais bornee. Trop etroite le nom du
// produit disparait, trop large il ne reste plus rien pour la barre.
const gouttiere = computed(() => Math.round(Math.min(180, Math.max(84, largeur.value * 0.3))))
const colonneValeur = computed(() => Math.round(Math.min(110, Math.max(64, largeur.value * 0.2))))
const pisteH = computed(() =>
  Math.max(24, largeur.value - gouttiere.value - colonneValeur.value - 20)
)
const hauteurH = computed(() => Math.max(1, entrees.value.length) * props.hauteurBarre)

// SVG ne coupe pas le texte tout seul : au-dela de la gouttiere il deborderait
// sur la barre. On estime la largeur d'un caractere a 6.2 px pour 12.5 px de
// fonte, ce qui suffit pour decider ou couper.
function tronquer(texte, largeurDispo) {
  const t = String(texte ?? '')
  const max = Math.floor(largeurDispo / 6.2)
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}…`
}

/* --- Vertical ------------------------------------------------------------- */

const HAUTEUR_V = 190
const MARGE_V = { haut: 8, bas: 30 }
const largeurColonne = computed(() => largeur.value / Math.max(1, entrees.value.length))

/**
 * Barre a extremite arrondie du seul cote ou elle grandit : le pied reste
 * franc sur la ligne de base, sinon la barre semble flotter.
 */
function cheminBarre(x, y, w, h, r, sens) {
  const rayon = Math.max(0, Math.min(r, sens === 'droite' ? w : h, sens === 'droite' ? h / 2 : w / 2))
  if (rayon <= 0.5) return `M${x},${y} h${w} v${h} h${-w} Z`
  if (sens === 'droite') {
    return `M${x},${y} h${w - rayon} a${rayon},${rayon} 0 0 1 ${rayon},${rayon} v${h - rayon * 2} a${rayon},${rayon} 0 0 1 ${-rayon},${rayon} h${-(w - rayon)} Z`
  }
  return `M${x},${y + rayon} a${rayon},${rayon} 0 0 1 ${rayon},${-rayon} h${w - rayon * 2} a${rayon},${rayon} 0 0 1 ${rayon},${rayon} v${h - rayon} h${-w} Z`
}

const barres = computed(() => {
  if (horizontal.value) {
    return entrees.value.map((d, i) => {
      const l = (Number(d.valeur) / maximum.value) * pisteH.value
      const y = i * props.hauteurBarre
      const centre = y + props.hauteurBarre / 2
      return {
        cle: `${d.label}-${i}`,
        label: d.label,
        labelCourt: tronquer(d.label, gouttiere.value - 10),
        valeur: props.formatValeur(d.valeur),
        couleur: d.couleur || props.couleur,
        chemin: cheminBarre(gouttiere.value, centre - 7, Math.max(2, l), 14, 4, 'droite'),
        yTexte: centre + 4.4,
        yLigne: y,
        hauteurLigne: props.hauteurBarre,
      }
    })
  }
  const plot = HAUTEUR_V - MARGE_V.haut - MARGE_V.bas
  return entrees.value.map((d, i) => {
    const h = Math.max(2, (Number(d.valeur) / maximum.value) * plot)
    const w = Math.min(46, largeurColonne.value * 0.56)
    const x = i * largeurColonne.value + (largeurColonne.value - w) / 2
    return {
      cle: `${d.label}-${i}`,
      label: d.label,
      labelCourt: tronquer(d.label, largeurColonne.value - 6),
      valeur: props.formatValeur(d.valeur),
      couleur: d.couleur || props.couleur,
      chemin: cheminBarre(x, MARGE_V.haut + plot - h, w, h, 4, 'haut'),
      xTexte: x + w / 2,
      yTexte: HAUTEUR_V - MARGE_V.bas + 14,
      yValeur: MARGE_V.haut + plot - h - 5,
    }
  })
})

const survolee = ref(null)

const resume = computed(() => {
  if (props.ariaLabel) return props.ariaLabel
  return entrees.value.map((d) => `${d.label} : ${props.formatValeur(d.valeur)}`).join(', ')
})
</script>

<template>
  <div ref="conteneur" class="chart">
    <EmptyState v-if="vide" icon="chart" :title="videTitre" :desc="videTexte" />

    <svg
      v-else-if="horizontal"
      class="chart-svg"
      :viewBox="`0 0 ${largeur} ${hauteurH}`"
      :height="hauteurH"
      role="img"
      :aria-label="resume"
    >
      <g
        v-for="b in barres"
        :key="b.cle"
        @pointerenter="survolee = b.cle"
        @pointerleave="survolee = null"
      >
        <rect
          class="chart-ligne-fond"
          :class="{ 'is-hover': survolee === b.cle }"
          x="0"
          :y="b.yLigne"
          :width="largeur"
          :height="b.hauteurLigne"
        />
        <title>{{ b.label }} : {{ b.valeur }}</title>
        <text class="chart-libelle" x="0" :y="b.yTexte">{{ b.labelCourt }}</text>
        <path :d="b.chemin" :fill="b.couleur" />
        <text class="chart-valeur" :x="largeur" :y="b.yTexte" text-anchor="end">{{ b.valeur }}</text>
      </g>
    </svg>

    <svg
      v-else
      class="chart-svg"
      :viewBox="`0 0 ${largeur} ${HAUTEUR_V}`"
      :height="HAUTEUR_V"
      role="img"
      :aria-label="resume"
    >
      <g v-for="b in barres" :key="b.cle">
        <title>{{ b.label }} : {{ b.valeur }}</title>
        <path :d="b.chemin" :fill="b.couleur" />
        <text class="chart-valeur" :x="b.xTexte" :y="b.yValeur" text-anchor="middle">{{ b.valeur }}</text>
        <text class="chart-libelle" :x="b.xTexte" :y="b.yTexte" text-anchor="middle">{{ b.labelCourt }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
  min-width: 0;
}
.chart-svg { display: block; width: 100%; }

.chart-ligne-fond {
  fill: transparent;
  rx: 6;
  transition: fill var(--transition);
}
.chart-ligne-fond.is-hover { fill: var(--bg-subtle); }

.chart-libelle {
  fill: var(--text);
  font-size: 12.5px;
  font-weight: 550;
}
.chart-valeur {
  fill: var(--text-h);
  font-size: 12.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
</style>
