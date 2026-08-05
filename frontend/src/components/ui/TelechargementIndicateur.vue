<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useTelechargementsStore } from '../../stores/telechargements'
import { formatTaille } from '../../utils/telecharger'
import Icon from './Icon.vue'

// Indicateur de telechargement, sur le principe de celui de Firefox : absent
// tant qu'il ne se passe rien, il apparait des qu'un document est demande, se
// remplit au fur et a mesure, et donne acces a la liste des fichiers recus.

const telechargements = useTelechargementsStore()

const racine = ref(null)

const visible = computed(() => telechargements.visible)
const actifs = computed(() => telechargements.actifs)
const progression = computed(() => telechargements.progressionGlobale)
const indetermine = computed(() => telechargements.progressionIndeterminee)

// Le masquage differe depend du temps qui passe et non d'un evenement : sans
// cette horloge, l'indicateur resterait affiche jusqu'a la prochaine action.
let horloge = null

function demarrerHorloge() {
  if (horloge) return
  horloge = setInterval(() => telechargements.rafraichir(), 1000)
}

function arreterHorloge() {
  clearInterval(horloge)
  horloge = null
}

// L'horloge ne tourne que lorsqu'elle sert a quelque chose.
watch(
  () => telechargements.elements.length,
  (nombre) => (nombre ? demarrerHorloge() : arreterHorloge()),
  { immediate: true }
)

function surClicExterieur(evenement) {
  if (!telechargements.panneauOuvert) return
  if (racine.value && !racine.value.contains(evenement.target)) {
    telechargements.fermerPanneau()
  }
}

function surTouche(evenement) {
  if (evenement.key === 'Escape') telechargements.fermerPanneau()
}

onMounted(() => {
  document.addEventListener('click', surClicExterieur)
  document.addEventListener('keydown', surTouche)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', surClicExterieur)
  document.removeEventListener('keydown', surTouche)
  arreterHorloge()
})

function libelleEtat(element) {
  if (element.statut === 'en_cours') {
    if (element.progression === null) {
      return element.recus ? `${formatTaille(element.recus)} recus` : 'Preparation du document...'
    }
    return `${element.progression} % - ${formatTaille(element.recus)} sur ${formatTaille(element.total)}`
  }
  if (element.statut === 'termine') return formatTaille(element.taille)
  if (element.statut === 'annule') return 'Annule'
  return element.erreur
}

function icone(element) {
  if (element.statut === 'termine') return 'check'
  if (element.statut === 'echec') return 'alert'
  if (element.statut === 'annule') return 'x'
  return 'download'
}

// Rouvre un fichier deja recu sans le redemander au serveur.
function ouvrir(element) {
  if (!element.url) return
  window.open(element.url, '_blank', 'noopener')
}

// Geometrie de l'anneau de progression.
const RAYON = 9
const CIRCONFERENCE = 2 * Math.PI * RAYON
const decalage = computed(() => CIRCONFERENCE * (1 - progression.value / 100))
</script>

<template>
  <div v-if="visible" ref="racine" class="tel-indicateur">
    <button
      type="button"
      class="icon-btn tel-bouton"
      :class="{ 'is-actif': actifs.length > 0 }"
      :title="actifs.length ? `${actifs.length} telechargement(s) en cours` : 'Telechargements'"
      :aria-expanded="telechargements.panneauOuvert"
      aria-haspopup="dialog"
      @click.stop="telechargements.basculerPanneau()"
    >
      <svg v-if="actifs.length" class="tel-anneau" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="tel-anneau-fond" cx="12" cy="12" :r="RAYON" />
        <circle
          class="tel-anneau-jauge"
          :class="{ 'is-indetermine': indetermine }"
          cx="12"
          cy="12"
          :r="RAYON"
          :stroke-dasharray="CIRCONFERENCE"
          :stroke-dashoffset="indetermine ? CIRCONFERENCE * 0.7 : decalage"
        />
      </svg>
      <Icon name="download" :size="17" class="tel-fleche" :class="{ 'is-anime': actifs.length > 0 }" />
      <span v-if="actifs.length" class="tel-pastille">{{ actifs.length }}</span>
    </button>

    <div v-if="telechargements.panneauOuvert" class="tel-panneau" role="dialog" aria-label="Telechargements">
      <div class="tel-panneau-tete">
        <span class="tel-panneau-titre">Telechargements</span>
        <button
          v-if="telechargements.termines.length"
          type="button"
          class="btn-sm btn-ghost"
          @click="telechargements.viderTermines()"
        >
          Effacer la liste
        </button>
      </div>

      <ul class="tel-liste">
        <li v-for="element in telechargements.elements" :key="element.id" class="tel-ligne" :class="`est-${element.statut}`">
          <span class="tel-ligne-icone"><Icon :name="icone(element)" :size="15" /></span>

          <div class="tel-ligne-corps">
            <span class="tel-ligne-nom" :title="element.nomFichier">{{ element.libelle }}</span>
            <span class="tel-ligne-etat">{{ libelleEtat(element) }}</span>

            <div v-if="element.statut === 'en_cours'" class="tel-barre">
              <div
                class="tel-barre-jauge"
                :class="{ 'is-indetermine': element.progression === null }"
                :style="element.progression !== null ? { width: `${element.progression}%` } : null"
              />
            </div>
          </div>

          <div class="tel-ligne-actions">
            <button
              v-if="element.statut === 'en_cours'"
              type="button"
              class="icon-btn"
              title="Annuler"
              @click="telechargements.annuler(element.id)"
            >
              <Icon name="x" :size="14" />
            </button>
            <button
              v-else-if="element.statut === 'termine'"
              type="button"
              class="icon-btn"
              title="Ouvrir le document"
              @click="ouvrir(element)"
            >
              <Icon name="eye" :size="14" />
            </button>
            <button
              v-if="element.statut !== 'en_cours'"
              type="button"
              class="icon-btn"
              title="Retirer de la liste"
              @click="telechargements.retirer(element.id)"
            >
              <Icon name="trash" :size="14" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.tel-indicateur { position: relative; display: inline-flex; }

.tel-bouton { position: relative; }
.tel-anneau { position: absolute; inset: 0; margin: auto; width: 30px; height: 30px; transform: rotate(-90deg); }
.tel-anneau-fond { fill: none; stroke: var(--border); stroke-width: 2; }
.tel-anneau-jauge {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s ease;
}
/* Taille inconnue : l'anneau tourne au lieu d'afficher un pourcentage invente. */
.tel-anneau-jauge.is-indetermine {
  transform-origin: 12px 12px;
  animation: tel-rotation 1.1s linear infinite;
  transition: none;
}
.tel-fleche.is-anime { animation: tel-pulsation 1.6s ease-in-out infinite; }

.tel-pastille {
  position: absolute;
  top: -2px; right: -2px;
  min-width: 15px; height: 15px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}

.tel-panneau {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  width: min(340px, calc(100vw - 24px));
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-card, var(--bg));
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.18));
  overflow: hidden;
}
.tel-panneau-tete {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
}
.tel-panneau-titre { font-size: 12.5px; font-weight: 650; color: var(--text-h); }

.tel-liste { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow-y: auto; }
.tel-ligne {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.tel-ligne:last-child { border-bottom: none; }

.tel-ligne-icone { flex: none; margin-top: 2px; color: var(--text-muted); }
.est-termine .tel-ligne-icone { color: var(--success); }
.est-echec .tel-ligne-icone { color: var(--danger); }

.tel-ligne-corps { flex: 1; min-width: 0; }
.tel-ligne-nom {
  display: block;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--text-h);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tel-ligne-etat { display: block; margin-top: 1px; font-size: 11px; color: var(--text-muted); }
.est-echec .tel-ligne-etat { color: var(--danger); }

.tel-barre {
  margin-top: 6px;
  height: 3px;
  border-radius: 999px;
  background: var(--border);
  overflow: hidden;
}
.tel-barre-jauge {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.25s ease;
}
.tel-barre-jauge.is-indetermine {
  width: 35%;
  animation: tel-glissement 1.2s ease-in-out infinite;
}

.tel-ligne-actions { flex: none; display: flex; gap: 2px; }

@keyframes tel-rotation { to { transform: rotate(360deg); } }
@keyframes tel-pulsation { 50% { opacity: 0.55; } }
@keyframes tel-glissement {
  0% { margin-left: -35%; }
  100% { margin-left: 100%; }
}

/* Sur telephone le menu deroulant devient une feuille ancree en bas : un
   panneau de 340px suspendu sous la barre serait a moitie hors ecran. */
@media (max-width: 700px) {
  .tel-panneau {
    position: fixed;
    top: auto;
    right: 8px;
    left: 8px;
    bottom: calc(var(--bottom-nav-h, 62px) + 10px);
    width: auto;
  }
  .tel-liste { max-height: 50vh; }
}

/* Respecte le reglage systeme "reduire les animations". */
@media (prefers-reduced-motion: reduce) {
  .tel-anneau-jauge.is-indetermine,
  .tel-fleche.is-anime,
  .tel-barre-jauge.is-indetermine { animation: none; }
}
</style>
