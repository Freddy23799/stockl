<script setup>
import { ref, onUnmounted, nextTick, watch } from 'vue'
import Icon from './Icon.vue'

// -----------------------------------------------------------------------------
// Choix d'une photo : import de fichier ou prise de vue.
//
// Extrait de l'ecran Produits, ou il ne vivait que dans une modale ouverte
// depuis la liste. La photo ne pouvait donc etre posee qu'APRES avoir cree la
// fiche : on remplissait le formulaire, on validait, on retrouvait le produit
// dans la liste, et on rouvrait une autre fenetre pour la photo. Trois etapes
// pour une chose qui appartient au formulaire.
//
// Le composant ne connait rien au serveur : il rend un File, et c'est
// l'appelant qui decide quand et ou l'envoyer. C'est ce qui lui permet de
// servir aussi bien a la creation - ou aucun identifiant n'existe encore -
// qu'a la modification.
// -----------------------------------------------------------------------------

const props = defineProps({
  // Photo deja enregistree, affichee tant qu'aucune nouvelle n'est choisie.
  apercuActuel: { type: String, default: '' },
  coteMax: { type: Number, default: 1280 },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['choisie'])

// 'choix' : on choisit la source · 'camera' : flux en direct · 'apercu' : image prete
const mode = ref('choix')
const origine = ref('fichier')
const preparation = ref(false)
const erreur = ref('')
const apercu = ref('')
const videoRef = ref(null)

// getUserMedia n'existe qu'en contexte securise (HTTPS ou localhost). Sur une
// origine en clair l'objet est absent : plutot que de proposer un bouton qui
// echouera, on se rabat sur l'appareil photo natif via `capture`.
const cameraDisponible =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

let flux = null

function arreterFlux() {
  if (flux) {
    // stop() explicite sur chaque piste : sans cela le voyant de la camera
    // reste allume et la batterie se vide, la liberation automatique
    // n'intervient pas a la fermeture.
    flux.getTracks().forEach((piste) => piste.stop())
    flux = null
  }
  if (videoRef.value) videoRef.value.srcObject = null
}

function libererApercu() {
  if (apercu.value) URL.revokeObjectURL(apercu.value)
  apercu.value = ''
}

// Une photo de telephone fait couramment 4 000 px de large et depasse les 5 Mo
// acceptes par le serveur. On ramene le plus grand cote au maximum voulu en
// gardant le ratio : largement assez pour une fiche, et l'envoi passe.
function reduireEnJpeg(source, largeurSource, hauteurSource) {
  const ratio = Math.min(1, props.coteMax / Math.max(largeurSource, hauteurSource))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(largeurSource * ratio))
  canvas.height = Math.max(1, Math.round(hauteurSource * ratio))
  const contexte = canvas.getContext('2d')
  contexte.imageSmoothingEnabled = true
  contexte.imageSmoothingQuality = 'high'
  contexte.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
}

function poserPhoto(blob) {
  libererApercu()
  // Le serveur valide le format sur l'EXTENSION du nom recu (voir
  // upload.middleware.js) : un Blob anonyme arriverait sans extension et serait
  // refuse. D'ou le nom explicite en .jpg.
  const fichier = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  apercu.value = URL.createObjectURL(blob)
  mode.value = 'apercu'
  emit('choisie', fichier)
}

function chargerImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image illisible'))
    image.src = url
  })
}

async function surChoixFichier(e) {
  const fichier = e.target.files[0] || null
  // Le champ est vide immediatement : sans cela, reprendre le MEME fichier
  // apres un « Reprendre » ne declencherait aucun evenement change.
  e.target.value = ''
  if (!fichier) return

  erreur.value = ''
  origine.value = 'fichier'
  preparation.value = true
  const url = URL.createObjectURL(fichier)
  try {
    const image = await chargerImage(url)
    const blob = await reduireEnJpeg(image, image.naturalWidth, image.naturalHeight)
    if (!blob) throw new Error('Encodage impossible')
    poserPhoto(blob)
  } catch {
    // La reduction a echoue : on garde le fichier d'origine tel quel. Un refus
    // explicite du serveur vaut mieux qu'un bouton qui ne fait rien.
    libererApercu()
    apercu.value = URL.createObjectURL(fichier)
    mode.value = 'apercu'
    emit('choisie', fichier)
  } finally {
    URL.revokeObjectURL(url)
    preparation.value = false
  }
}

function messageErreurCamera(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    return 'Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur.'
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return 'Aucune caméra détectée sur cet appareil.'
  }
  if (err?.name === 'NotReadableError') {
    return 'La caméra est déjà utilisée par une autre application.'
  }
  if (err?.name === 'OverconstrainedError') {
    return 'Aucune caméra ne correspond aux réglages demandés.'
  }
  return "La caméra n'a pas pu être ouverte."
}

async function ouvrirCamera() {
  erreur.value = ''
  origine.value = 'camera'
  mode.value = 'camera'
  // Le <video> n'existe qu'apres le rendu du mode camera : sans ce nextTick,
  // srcObject serait pose sur null.
  await nextTick()
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      // Camera arriere : on photographie un article pose devant soi, pas soi.
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    })
    if (!videoRef.value) {
      // Le composant a ete referme pendant que l'utilisateur repondait a la
      // demande d'autorisation : le flux ouvert doit etre relache tout de suite.
      arreterFlux()
      return
    }
    videoRef.value.muted = true
    videoRef.value.srcObject = flux
  } catch (err) {
    arreterFlux()
    mode.value = 'choix'
    erreur.value = messageErreurCamera(err)
  }
}

function annulerCamera() {
  arreterFlux()
  mode.value = 'choix'
}

async function capturer() {
  const video = videoRef.value
  if (!video || !video.videoWidth) return
  preparation.value = true
  try {
    const blob = await reduireEnJpeg(video, video.videoWidth, video.videoHeight)
    if (blob) poserPhoto(blob)
    else erreur.value = "La capture n'a pas pu être encodée."
  } finally {
    preparation.value = false
    // Le cliche est pris : la camera n'a plus aucune raison de rester allumee.
    arreterFlux()
  }
}

function reprendre() {
  libererApercu()
  emit('choisie', null)
  if (origine.value === 'camera' && cameraDisponible) ouvrirCamera()
  else mode.value = 'choix'
}

/** Remet le composant a zero. Appele par le parent a l'ouverture d'un formulaire. */
function reinitialiser() {
  arreterFlux()
  libererApercu()
  mode.value = 'choix'
  origine.value = 'fichier'
  erreur.value = ''
  emit('choisie', null)
}

defineExpose({ reinitialiser })

// Changer de fiche sans demonter le composant doit repartir d'un etat propre,
// sinon l'apercu de la fiche precedente reste affiche sur la nouvelle.
watch(() => props.apercuActuel, () => {
  if (mode.value === 'apercu') return
  erreur.value = ''
})

onUnmounted(() => {
  arreterFlux()
  libererApercu()
})
</script>

<template>
  <div class="choix-photo" :class="{ compact }">
    <template v-if="mode === 'choix'">
      <div class="row" style="gap: 14px; align-items: flex-start">
        <img v-if="apercuActuel" :src="apercuActuel" class="thumb thumb-lg" alt="" />
        <div v-else class="thumb thumb-lg"><Icon name="image" :size="20" /></div>
        <p class="flex-1 small muted">
          L'image est réduite à {{ coteMax }} px avant l'envoi : une photo prise au téléphone
          dépasserait sinon la limite de 5 Mo du serveur.
        </p>
      </div>

      <div class="photo-sources">
        <label class="photo-source">
          <Icon name="download" :size="19" />
          <span class="photo-source-titre">Importer un fichier</span>
          <span class="photo-source-desc">JPG, PNG ou WebP</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" @change="surChoixFichier" />
        </label>

        <button v-if="cameraDisponible" type="button" class="photo-source" @click="ouvrirCamera">
          <Icon name="image" :size="19" />
          <span class="photo-source-titre">Prendre une photo</span>
          <span class="photo-source-desc">Caméra arrière</span>
        </button>
        <!-- Pas de getUserMedia (origine non securisee, navigateur ancien) :
             `capture` ouvre quand meme l'appareil photo natif sur mobile. -->
        <label v-else class="photo-source">
          <Icon name="image" :size="19" />
          <span class="photo-source-titre">Prendre une photo</span>
          <span class="photo-source-desc">Appareil photo de l'appareil</span>
          <input type="file" accept="image/*" capture="environment" @change="surChoixFichier" />
        </label>
      </div>

      <p v-if="preparation" class="field-hint row"><span class="spinner" /> Préparation de l'image...</p>
    </template>

    <template v-else-if="mode === 'camera'">
      <div class="photo-cadre">
        <video ref="videoRef" autoplay playsinline muted></video>
      </div>
      <div class="row" style="gap: 8px">
        <button type="button" class="flex-1" @click="annulerCamera">Annuler</button>
        <button type="button" class="primary flex-1" :disabled="preparation" @click="capturer">
          <span v-if="preparation" class="spinner" />
          <Icon v-else name="check" :size="15" />
          Capturer
        </button>
      </div>
    </template>

    <template v-else>
      <div class="photo-cadre">
        <img :src="apercu" alt="Aperçu de la photo à envoyer" />
      </div>
      <button type="button" class="btn-block" @click="reprendre">
        <Icon name="refresh" :size="15" /> Reprendre la photo
      </button>
    </template>

    <p v-if="erreur" class="alert alert-danger">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>
  </div>
</template>

<style scoped>
.choix-photo {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Dans un formulaire deja long, la zone photo ne doit pas occuper autant de
   place que dans une fenetre qui ne sert qu'a ca. */
.choix-photo.compact :deep(.photo-cadre) { max-height: 190px; }
</style>
