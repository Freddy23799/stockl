<script setup>
import { computed, ref } from 'vue'
import EmptyState from './EmptyState.vue'
import { TEINTES_CATEGORIES, TEINTE_AUTRES, LIBELLE_AUTRES } from './palette'

// Anneau de repartition.
//
// Taille fixe en pixels plutot qu'un viewBox etire : le total au centre reste
// a sa taille nominale quelle que soit la largeur du conteneur, et la legende
// passe simplement dessous quand la place manque.
const props = defineProps({
  data: { type: Array, default: () => [] },
  formatValeur: { type: Function, default: (v) => String(v) },
  libelleTotal: { type: String, default: 'Total' },
  formatTotal: { type: Function, default: null },
  ariaLabel: { type: String, default: '' },
  videTitre: { type: String, default: 'Aucune donnee' },
  videTexte: { type: String, default: '' },
})

const TAILLE = 168
const RAYON = 68
const EPAISSEUR = 20
const CIRCONFERENCE = 2 * Math.PI * RAYON
// Interstice entre deux parts, exprime en unites d'arc. Sans lui, deux teintes
// voisines se touchent et la frontiere devient invisible en niveaux de gris.
const INTERSTICE = 3

const total = computed(() =>
  props.data.reduce((s, d) => s + Math.max(0, Number(d.valeur) || 0), 0)
)

const vide = computed(() => total.value <= 0)

/* Regroupement.
   Deux raisons de replier des parts dans « Autres » : une part sous 3 % donne
   un filet de couleur illisible, et au-dela de quatre categories il faudrait
   inventer des teintes — on n'en fabrique jamais, elles finiraient par se
   ressembler. */
const parts = computed(() => {
  if (vide.value) return []
  const triees = props.data
    .map((d) => ({ label: String(d.label ?? ''), valeur: Math.max(0, Number(d.valeur) || 0), couleur: d.couleur }))
    .filter((d) => d.valeur > 0)
    .sort((a, b) => b.valeur - a.valeur)

  const principales = []
  let reste = 0
  for (const d of triees) {
    const part = d.valeur / total.value
    if (principales.length < TEINTES_CATEGORIES.length && part >= 0.03) principales.push(d)
    else reste += d.valeur
  }
  const liste = principales.map((d, i) => ({ ...d, couleur: d.couleur || TEINTES_CATEGORIES[i] }))
  if (reste > 0) liste.push({ label: LIBELLE_AUTRES, valeur: reste, couleur: TEINTE_AUTRES })
  return liste
})

const segments = computed(() => {
  let cumul = 0
  return parts.value.map((p) => {
    const longueur = (p.valeur / total.value) * CIRCONFERENCE
    const decalage = cumul
    cumul += longueur
    const pourcentage = (p.valeur / total.value) * 100
    return {
      ...p,
      pourcentage,
      // Une part unique n'a pas de voisine : lui retirer un interstice
      // laisserait une encoche sans raison.
      dasharray:
        parts.value.length > 1
          ? `${Math.max(0.5, longueur - INTERSTICE)} ${CIRCONFERENCE - Math.max(0.5, longueur - INTERSTICE)}`
          : `${longueur} 0`,
      dashoffset: -decalage,
    }
  })
})

const survolee = ref(null)

const totalAffiche = computed(() =>
  (props.formatTotal || props.formatValeur)(total.value)
)

const resume = computed(() => {
  if (props.ariaLabel) return props.ariaLabel
  return `Repartition : ${segments.value
    .map((s) => `${s.label} ${s.pourcentage.toFixed(0)} %`)
    .join(', ')}. Total ${totalAffiche.value}`
})
</script>

<template>
  <div class="donut">
    <EmptyState v-if="vide" icon="chart" :title="videTitre" :desc="videTexte" />

    <template v-else>
      <svg
        class="donut-svg"
        :width="TAILLE"
        :height="TAILLE"
        :viewBox="`0 0 ${TAILLE} ${TAILLE}`"
        role="img"
        :aria-label="resume"
      >
        <!-- Le -90deg fait demarrer la premiere part a midi : c'est la ou l'oeil
             commence a lire un cadran. -->
        <g :transform="`rotate(-90 ${TAILLE / 2} ${TAILLE / 2})`">
          <circle
            v-for="s in segments"
            :key="s.label"
            :cx="TAILLE / 2"
            :cy="TAILLE / 2"
            :r="RAYON"
            fill="none"
            :stroke="s.couleur"
            :stroke-width="EPAISSEUR"
            :stroke-dasharray="s.dasharray"
            :stroke-dashoffset="s.dashoffset"
            :opacity="survolee && survolee !== s.label ? 0.35 : 1"
            class="donut-part"
          >
            <title>{{ s.label }} : {{ formatValeur(s.valeur) }}</title>
          </circle>
        </g>
        <text class="donut-total" :x="TAILLE / 2" :y="TAILLE / 2 + 2" text-anchor="middle">
          {{ totalAffiche }}
        </text>
        <text class="donut-total-label" :x="TAILLE / 2" :y="TAILLE / 2 + 20" text-anchor="middle">
          {{ libelleTotal }}
        </text>
      </svg>

      <ul class="donut-legende">
        <li
          v-for="s in segments"
          :key="s.label"
          @pointerenter="survolee = s.label"
          @pointerleave="survolee = null"
        >
          <span class="donut-pastille" :style="{ background: s.couleur }" />
          <span class="donut-label">{{ s.label }}</span>
          <span class="donut-pct tnum">{{ s.pourcentage.toFixed(s.pourcentage < 10 ? 1 : 0) }} %</span>
          <span class="donut-valeur tnum">{{ formatValeur(s.valeur) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.donut {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 18px;
  min-width: 0;
}
.donut-svg { flex-shrink: 0; margin: 0 auto; }
.donut-part { transition: opacity var(--transition); }

.donut-total {
  fill: var(--text-h);
  font-size: 17px;
  font-weight: 680;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.donut-total-label {
  fill: var(--text-muted);
  font-size: 11px;
}

.donut-legende {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-width: 190px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.donut-legende li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-muted);
  padding: 4px 6px;
  border-radius: var(--r-sm);
  min-width: 0;
}
.donut-legende li:hover { background: var(--bg-subtle); }
.donut-pastille {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex-shrink: 0;
}
.donut-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.donut-pct { color: var(--text-h); font-weight: 650; }
.donut-valeur { color: var(--text-muted); white-space: nowrap; }
</style>
