<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import EmptyState from './EmptyState.vue'
import { echelleY, TEINTES_CATEGORIES } from './palette'

// Courbe (ou aire) pour une serie temporelle, tracee a la main en SVG : aucune
// librairie, donc rien a telecharger et la PWA reste utilisable hors ligne.
//
// Chaque serie : { label, points: [{ x, y }], couleur }. `x` est le libelle a
// afficher sous l'axe, la position vient de l'index — toutes les series doivent
// donc partager le meme axe des abscisses (ce qui est le cas d'un CA et de
// depenses issus du meme jour).
const props = defineProps({
  series: { type: Array, default: () => [] },
  height: { type: Number, default: 210 },
  formatY: { type: Function, default: (v) => String(v) },
  ariaLabel: { type: String, default: '' },
  videTitre: { type: String, default: 'Aucune donnee sur la periode' },
  videTexte: { type: String, default: '' },
})

/* --- Largeur reelle -------------------------------------------------------
   Le viewBox suit la largeur mesuree du conteneur : une unite de viewBox vaut
   donc exactement un pixel CSS. C'est ce qui garantit que le texte sort a sa
   taille nominale — un viewBox fixe qu'on laisse retrecir donnerait des
   libelles de 5 px sur un telephone, et `preserveAspectRatio="none"` les
   ecraserait. */
const conteneur = ref(null)
const largeur = ref(720)
let observateur = null

onMounted(() => {
  if (!conteneur.value) return
  const mesurer = () => {
    const l = conteneur.value?.clientWidth
    if (l) largeur.value = Math.max(240, l)
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

/* --- Geometrie ------------------------------------------------------------ */

const MARGE = { haut: 12, droite: 10, bas: 26, gauche: 54 }

const seriesUtiles = computed(() =>
  props.series.filter((s) => Array.isArray(s.points) && s.points.length)
)

const nbPoints = computed(() =>
  seriesUtiles.value.reduce((m, s) => Math.max(m, s.points.length), 0)
)

// Une serie entierement a zero n'est pas une serie : mieux vaut un etat vide
// explicite qu'une ligne plate collee a l'axe, qu'on prend pour un bug.
const vide = computed(
  () =>
    !seriesUtiles.value.length ||
    nbPoints.value < 2 ||
    !seriesUtiles.value.some((s) => s.points.some((p) => Number(p.y) > 0))
)

const maxBrut = computed(() =>
  seriesUtiles.value.reduce(
    (m, s) => s.points.reduce((mm, p) => Math.max(mm, Number(p.y) || 0), m),
    0
  )
)

const echelle = computed(() => echelleY(maxBrut.value, 4))

const plot = computed(() => ({
  x: MARGE.gauche,
  y: MARGE.haut,
  w: Math.max(10, largeur.value - MARGE.gauche - MARGE.droite),
  h: Math.max(10, props.height - MARGE.haut - MARGE.bas),
}))

function posX(i) {
  const n = nbPoints.value
  return plot.value.x + (n <= 1 ? plot.value.w / 2 : (i / (n - 1)) * plot.value.w)
}
function posY(valeur) {
  const ratio = (Number(valeur) || 0) / echelle.value.max
  return plot.value.y + plot.value.h - ratio * plot.value.h
}

const traces = computed(() =>
  seriesUtiles.value.map((s, index) => {
    const points = s.points.map((p, i) => `${posX(i).toFixed(2)},${posY(p.y).toFixed(2)}`)
    const ligne = `M${points.join(' L')}`
    // L'aire n'est remplie que pour la premiere serie : deux remplissages
    // superposes se melangent et on ne sait plus laquelle est devant.
    const aire =
      index === 0
        ? `${ligne} L${posX(s.points.length - 1).toFixed(2)},${(plot.value.y + plot.value.h).toFixed(2)} L${posX(0).toFixed(2)},${(plot.value.y + plot.value.h).toFixed(2)} Z`
        : ''
    return {
      label: s.label,
      couleur: s.couleur || TEINTES_CATEGORIES[index] || TEINTES_CATEGORIES[0],
      ligne,
      aire,
      points: s.points,
    }
  })
)

/* --- Libelles de l'axe des abscisses --------------------------------------
   Trente dates sur 340 px se chevauchent jusqu'a l'illisible : on n'en garde
   qu'une sur `pasLibelles`, calcule sur la largeur reellement disponible. */
const pasLibelles = computed(() => {
  const tiennent = Math.max(2, Math.floor(plot.value.w / 58))
  return Math.max(1, Math.ceil(nbPoints.value / tiennent))
})

const libellesX = computed(() => {
  const source = seriesUtiles.value[0]?.points || []
  const liste = []
  for (let i = 0; i < source.length; i += pasLibelles.value) {
    liste.push({ i, x: posX(i), texte: String(source[i].x ?? '') })
  }
  // Le dernier point est toujours nomme : c'est la valeur la plus recente,
  // celle qu'on regarde en premier.
  const dernier = source.length - 1
  if (dernier >= 0 && liste[liste.length - 1]?.i !== dernier) {
    if (posX(dernier) - liste[liste.length - 1]?.x < 46) liste.pop()
    liste.push({ i: dernier, x: posX(dernier), texte: String(source[dernier].x ?? '') })
  }
  return liste
})

/* --- Survol ---------------------------------------------------------------
   Une infobulle HTML positionnee en absolu, pas un <title> SVG : celui-ci
   n'apparait qu'au survol prolonge d'une souris et reste donc invisible sur
   telephone. */
const indexActif = ref(null)

function surPointeur(evenement) {
  if (vide.value || !conteneur.value) return
  const rect = conteneur.value.getBoundingClientRect()
  // Le SVG occupe toute la largeur du conteneur et le viewBox est en pixels :
  // la coordonnee de l'evenement se lit directement, sans conversion.
  const x = evenement.clientX - rect.left
  const ratio = (x - plot.value.x) / plot.value.w
  const i = Math.round(ratio * (nbPoints.value - 1))
  indexActif.value = Math.min(nbPoints.value - 1, Math.max(0, i))
}
function quitter() {
  indexActif.value = null
}

const infobulle = computed(() => {
  if (indexActif.value === null) return null
  const i = indexActif.value
  const x = posX(i)
  return {
    x,
    // L'infobulle bascule a gauche du point quand elle depasserait a droite.
    aGauche: x > plot.value.x + plot.value.w * 0.62,
    titre: String(seriesUtiles.value[0]?.points[i]?.x ?? ''),
    lignes: traces.value
      .filter((t) => t.points[i])
      .map((t) => ({ label: t.label, couleur: t.couleur, valeur: props.formatY(t.points[i].y) })),
  }
})

const resume = computed(() => {
  if (props.ariaLabel) return props.ariaLabel
  const noms = seriesUtiles.value.map((s) => s.label).join(' et ')
  return `Evolution de ${noms} sur ${nbPoints.value} jours, maximum ${props.formatY(maxBrut.value)}`
})
</script>

<template>
  <div ref="conteneur" class="chart">
    <EmptyState v-if="vide" icon="chart" :title="videTitre" :desc="videTexte" />

    <template v-else>
      <svg
        class="chart-svg"
        :viewBox="`0 0 ${largeur} ${height}`"
        :height="height"
        role="img"
        :aria-label="resume"
        @pointermove="surPointeur"
        @pointerdown="surPointeur"
        @pointerleave="quitter"
      >
        <!-- Grille : discrete, elle doit rester derriere la donnee -->
        <g class="chart-grille">
          <line
            v-for="g in echelle.graduations"
            :key="`g${g}`"
            :x1="plot.x"
            :x2="plot.x + plot.w"
            :y1="posY(g)"
            :y2="posY(g)"
          />
        </g>

        <g class="chart-axe">
          <text
            v-for="g in echelle.graduations"
            :key="`t${g}`"
            :x="plot.x - 8"
            :y="posY(g) + 3.5"
            text-anchor="end"
          >
            {{ formatY(g) }}
          </text>
          <text v-for="l in libellesX" :key="`x${l.i}`" :x="l.x" :y="height - 8" text-anchor="middle">
            {{ l.texte }}
          </text>
        </g>

        <g v-for="(t, i) in traces" :key="`s${i}`">
          <path v-if="t.aire" :d="t.aire" :fill="t.couleur" opacity="0.1" />
          <path :d="t.ligne" fill="none" :stroke="t.couleur" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round" />
        </g>

        <g v-if="indexActif !== null">
          <line
            class="chart-viseur"
            :x1="posX(indexActif)"
            :x2="posX(indexActif)"
            :y1="plot.y"
            :y2="plot.y + plot.h"
          />
          <!-- Anneau a la couleur de la surface : le point reste lisible meme
               quand deux series se croisent exactement. -->
          <circle
            v-for="(t, i) in traces"
            :key="`p${i}`"
            v-show="t.points[indexActif]"
            :cx="posX(indexActif)"
            :cy="posY(t.points[indexActif]?.y)"
            r="4.5"
            :fill="t.couleur"
            class="chart-point"
          />
        </g>
      </svg>

      <div
        v-if="infobulle"
        class="chart-bulle"
        :class="{ 'is-left': infobulle.aGauche }"
        :style="{ left: `${infobulle.x}px` }"
      >
        <p class="chart-bulle-titre">{{ infobulle.titre }}</p>
        <p v-for="l in infobulle.lignes" :key="l.label" class="chart-bulle-ligne">
          <span class="chart-pastille" :style="{ background: l.couleur }" />
          <span class="chart-bulle-label">{{ l.label }}</span>
          <span class="chart-bulle-valeur tnum">{{ l.valeur }}</span>
        </p>
      </div>

      <!-- Deux series ou plus : la legende est obligatoire, sinon l'identite
           d'une courbe ne tient qu'a sa couleur. -->
      <ul v-if="traces.length > 1" class="chart-legende">
        <li v-for="t in traces" :key="t.label">
          <span class="chart-pastille" :style="{ background: t.couleur }" />{{ t.label }}
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
  min-width: 0;
}
.chart-svg {
  display: block;
  width: 100%;
  /* Le defilement vertical de la page doit rester possible pendant qu'on suit
     la courbe du doigt. */
  touch-action: pan-y;
}

.chart-grille line {
  stroke: var(--border);
  stroke-width: 1;
}
.chart-axe text {
  fill: var(--text-muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.chart-viseur {
  stroke: var(--border-strong);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.chart-point {
  stroke: var(--bg-panel);
  stroke-width: 2;
}

.chart-bulle {
  position: absolute;
  top: 4px;
  transform: translateX(10px);
  pointer-events: none;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-md);
  padding: 7px 10px;
  min-width: 130px;
  z-index: 2;
}
.chart-bulle.is-left { transform: translateX(calc(-100% - 10px)); }
.chart-bulle-titre {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-h);
  margin-bottom: 3px;
}
.chart-bulle-ligne {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}
.chart-bulle-label { flex: 1; }
.chart-bulle-valeur { color: var(--text-h); font-weight: 600; }

.chart-pastille {
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  flex-shrink: 0;
}

.chart-legende {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.chart-legende li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
