<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { assetUrl } from '../../api/client'
import { telechargerDocument } from '../../utils/telecharger'
import Icon from './Icon.vue'

// -----------------------------------------------------------------------------
// Consultation d'une piece sans quitter l'application.
//
// Les fichiers s'ouvraient dans un onglet du navigateur. La personne quittait
// l'application, se retrouvait devant le lecteur PDF du systeme, et devait
// retrouver son chemin pour revenir a la fiche - en emportant au passage une
// URL de fichier hors de tout contexte.
//
// Ici, la piece s'affiche par-dessus la fiche : grande fenetre sur ordinateur,
// panneau glissant depuis le bas sur telephone, ou l'on referme d'un geste vers
// le bas comme dans n'importe quelle application mobile.
//
// Les dossiers n'acceptent a l'envoi que des images et des PDF. Le rendu
// distingue quand meme quatre familles - image, PDF, texte, et le reste - pour
// que l'ouverture d'un format ajoute plus tard n'ait pas a etre reecrite, et
// surtout pour qu'un fichier inattendu propose son telechargement au lieu
// d'afficher un cadre vide.
// -----------------------------------------------------------------------------

const props = defineProps({
  // { chemin, nom_original, type_mime, taille_octets }
  fichiers: { type: Array, required: true },
  indexInitial: { type: Number, default: 0 },
  titre: { type: String, default: '' },
})

const emit = defineEmits(['close'])

const index = ref(props.indexInitial)
const zoom = ref(1)
const chargement = ref(true)
const echec = ref(false)

const fichier = computed(() => props.fichiers[index.value] || null)
const plusieurs = computed(() => props.fichiers.length > 1)

function familleDe(f) {
  const mime = (f?.type_mime || '').toLowerCase()
  const nom = (f?.nom_original || f?.chemin || '').toLowerCase()
  if (mime.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)$/.test(nom)) return 'image'
  if (mime === 'application/pdf' || nom.endsWith('.pdf')) return 'pdf'
  if (mime.startsWith('text/') || /\.(txt|csv|md|log)$/.test(nom)) return 'texte'
  if (mime.startsWith('video/')) return 'video'
  return 'autre'
}

const famille = computed(() => familleDe(fichier.value))
const source = computed(() => (fichier.value ? assetUrl(fichier.value.chemin) : ''))

const texte = ref('')

async function chargerTexte() {
  texte.value = ''
  try {
    const reponse = await fetch(source.value)
    if (!reponse.ok) throw new Error('lecture impossible')
    // Borne volontaire : un fichier texte de plusieurs mega-octets bloquerait
    // le rendu, et personne ne lit un journal de cette taille dans une fenetre.
    texte.value = (await reponse.text()).slice(0, 200_000)
  } catch {
    echec.value = true
  } finally {
    chargement.value = false
  }
}

function surChangement() {
  zoom.value = 1
  echec.value = false
  chargement.value = famille.value !== 'autre'
  if (famille.value === 'texte') chargerTexte()
  else if (famille.value === 'autre') chargement.value = false
}

watch(index, surChangement)

function precedent() {
  if (!plusieurs.value) return
  index.value = (index.value - 1 + props.fichiers.length) % props.fichiers.length
}

function suivant() {
  if (!plusieurs.value) return
  index.value = (index.value + 1) % props.fichiers.length
}

function zoomer(pas) {
  zoom.value = Math.min(4, Math.max(1, Number((zoom.value + pas).toFixed(2))))
}

async function telecharger() {
  if (!fichier.value) return
  await telechargerDocument(source.value, fichier.value.nom_original || 'document')
}

function surTouche(e) {
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowLeft') precedent()
  else if (e.key === 'ArrowRight') suivant()
  else if (e.key === '+' || e.key === '=') zoomer(0.25)
  else if (e.key === '-') zoomer(-0.25)
}

/* --- Fermeture par glissement vers le bas (telephone) ---------------------- */

const decalage = ref(0)
let departY = null

function debutGeste(e) {
  // Uniquement depuis la poignee : glisser sur le contenu doit pouvoir le faire
  // defiler, pas refermer le panneau.
  departY = e.touches?.[0]?.clientY ?? null
}

function pendantGeste(e) {
  if (departY === null) return
  const y = e.touches?.[0]?.clientY ?? departY
  decalage.value = Math.max(0, y - departY)
}

function finGeste() {
  // Un tiers de la hauteur d'ecran : en dessous, le geste est plus souvent une
  // hesitation qu'une intention de fermer.
  if (decalage.value > window.innerHeight / 3) emit('close')
  decalage.value = 0
  departY = null
}

onMounted(() => {
  window.addEventListener('keydown', surTouche)
  // La page derriere ne doit pas defiler pendant la consultation.
  document.body.style.overflow = 'hidden'
  surChangement()
})

onUnmounted(() => {
  window.removeEventListener('keydown', surTouche)
  document.body.style.overflow = ''
})

const octets = (n) => {
  const v = Number(n || 0)
  if (v < 1024) return `${v} o`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} ko`
  return `${(v / 1024 / 1024).toFixed(1)} Mo`
}
</script>

<template>
  <div class="visionneuse" role="dialog" aria-modal="true" @click.self="emit('close')">
    <div
      class="visionneuse-panneau"
      :style="decalage ? { transform: `translateY(${decalage}px)`, transition: 'none' } : null"
    >
      <!-- Poignee de glissement : visible uniquement sur telephone. -->
      <div
        class="poignee"
        @touchstart.passive="debutGeste"
        @touchmove.passive="pendantGeste"
        @touchend="finGeste"
      >
        <span></span>
      </div>

      <header class="visionneuse-tete">
        <div class="tete-texte">
          <p class="tete-nom" :title="fichier?.nom_original">{{ fichier?.nom_original || 'Document' }}</p>
          <p class="tete-meta">
            <span v-if="titre">{{ titre }}</span>
            <span v-if="titre">·</span>
            <span>{{ octets(fichier?.taille_octets) }}</span>
            <span v-if="plusieurs">· {{ index + 1 }} / {{ fichiers.length }}</span>
          </p>
        </div>

        <div class="tete-actions">
          <template v-if="famille === 'image'">
            <button type="button" class="btn-sm btn-ghost" title="Réduire" @click="zoomer(-0.25)">
              <Icon name="minus" :size="15" />
            </button>
            <span class="zoom-valeur tnum">{{ Math.round(zoom * 100) }} %</span>
            <button type="button" class="btn-sm btn-ghost" title="Agrandir" @click="zoomer(0.25)">
              <Icon name="plus" :size="15" />
            </button>
          </template>
          <button type="button" class="btn-sm btn-ghost" title="Télécharger" @click="telecharger">
            <Icon name="download" :size="16" />
          </button>
          <button type="button" class="btn-sm btn-ghost" title="Fermer" @click="emit('close')">
            <Icon name="x" :size="16" />
          </button>
        </div>
      </header>

      <div class="visionneuse-corps">
        <button v-if="plusieurs" type="button" class="fleche fleche-gauche" title="Précédent" @click="precedent">
          <Icon name="chevronLeft" :size="18" />
        </button>

        <div class="zone" :class="`zone-${famille}`">
          <div v-if="chargement && famille !== 'texte'" class="etat">
            <span class="spinner" /> Chargement...
          </div>

          <template v-if="famille === 'image'">
            <img
              v-show="!echec"
              :src="source"
              :alt="fichier?.nom_original"
              :style="{ transform: `scale(${zoom})` }"
              @load="chargement = false"
              @error="chargement = false; echec = true"
            />
          </template>

          <!-- Un PDF est rendu par le lecteur integre du navigateur, dans un
               cadre isole : aucune bibliotheque a embarquer, et le rendu reste
               celui que la personne connait deja. -->
          <iframe
            v-else-if="famille === 'pdf'"
            :src="`${source}#toolbar=1&navpanes=0`"
            :title="fichier?.nom_original"
            @load="chargement = false"
          ></iframe>

          <pre v-else-if="famille === 'texte'" class="texte">{{ texte }}</pre>

          <video v-else-if="famille === 'video'" :src="source" controls @loadeddata="chargement = false"></video>

          <div v-else class="etat">
            <Icon name="receipt" :size="34" />
            <p>Ce format ne peut pas être affiché ici.</p>
            <button type="button" class="primary" @click="telecharger">
              <Icon name="download" :size="15" /> Télécharger le fichier
            </button>
          </div>

          <div v-if="echec" class="etat">
            <Icon name="alert" :size="30" />
            <p>Le fichier n'a pas pu être affiché.</p>
            <p class="small muted">
              Sur l'hébergement gratuit, les fichiers envoyés sont perdus à chaque redémarrage du
              service : la fiche existe toujours, mais l'image n'est plus sur le disque.
            </p>
          </div>
        </div>

        <button v-if="plusieurs" type="button" class="fleche fleche-droite" title="Suivant" @click="suivant">
          <Icon name="chevronRight" :size="18" />
        </button>
      </div>

      <!-- Pellicule : sur un dossier de plusieurs pieces, passer de l'une a
           l'autre sans refermer la fenetre. -->
      <div v-if="plusieurs" class="pellicule">
        <button
          v-for="(f, i) in fichiers"
          :key="f.id ?? i"
          type="button"
          class="pellicule-vignette"
          :class="{ 'is-active': i === index }"
          :title="f.nom_original"
          @click="index = i"
        >
          <img v-if="familleDe(f) === 'image'" :src="assetUrl(f.chemin, { taille: 'vignette' })" alt="" loading="lazy" />
          <Icon v-else name="receipt" :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.visionneuse {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 26px;
  background: rgb(0 0 0 / 0.62);
  backdrop-filter: blur(2px);
}

.visionneuse-panneau {
  display: flex;
  flex-direction: column;
  width: min(1080px, 100%);
  height: min(88vh, 100%);
  border-radius: var(--r-lg);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  overflow: hidden;
  transition: transform 0.2s ease;
}

.poignee { display: none; }

.visionneuse-tete {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tete-texte { min-width: 0; flex: 1; }

.tete-nom {
  font-weight: 600;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Une seule ligne, tronquee au besoin. En flex, les trois fragments -
   « Contrat de travail », le poids, « 1 / 3 » - se repartissaient en colonnes
   etroites des que la largeur manquait, et la ligne devenait illisible sur
   telephone. */
.tete-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tete-meta span + span { margin-left: 5px; }

.tete-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.zoom-valeur {
  min-width: 44px;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.visionneuse-corps {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  background: var(--bg-subtle);
}

.zone {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Une image agrandie doit pouvoir etre parcourue, pas debordera l'ecran. */
  overflow: auto;
}

.zone img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 0.16s ease;
}

.zone iframe,
.zone video {
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--bg-subtle);
}

.texte {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 16px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
}

.etat {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.fleche {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border);
}

.fleche-gauche { left: 10px; }
.fleche-droite { right: 10px; }

.pellicule {
  display: flex;
  gap: 6px;
  padding: 9px 12px;
  overflow-x: auto;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.pellicule-vignette {
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  border: 2px solid transparent;
  background: var(--bg-subtle);
  overflow: hidden;
}

.pellicule-vignette img { width: 100%; height: 100%; object-fit: cover; }
.pellicule-vignette.is-active { border-color: var(--primary); }

/* -----------------------------------------------------------------------------
   Telephone : demi-page glissante depuis le bas.

   Une fenetre centree sur un ecran de 390 px laisse des marges inutiles et
   place la fermeture hors de portee du pouce. Le panneau vient du bas, occupe
   la hauteur utile, et se referme d'un glissement vers le bas - le geste que
   toutes les applications mobiles emploient deja.
   ----------------------------------------------------------------------------- */
@media (max-width: 760px) {
  .visionneuse {
    padding: 0;
    align-items: flex-end;
  }

  .visionneuse-panneau {
    width: 100%;
    height: 92vh;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    border-bottom: 0;
    animation: monter 0.24s ease;
  }

  .poignee {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 9px 0 5px;
    /* Cible tactile confortable autour d'un trait discret. */
    touch-action: none;
    cursor: grab;
  }

  .poignee span {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-strong);
  }

  /* Les fleches gaspillent la largeur sur un petit ecran : la pellicule et le
     glissement horizontal suffisent a changer de piece. */
  .fleche { display: none; }
}

@keyframes monter {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
