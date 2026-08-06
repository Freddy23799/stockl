<script setup>
import { ref, onBeforeUnmount, nextTick } from 'vue'
import jsQR from 'jsqr'
import api from '../../api/client'
import { formatMontant, formatDate, formatDateCourt } from '../../utils/format'
import { assetUrl } from '../../api/client'
import Modal from './Modal.vue'
import Icon from './Icon.vue'

// -----------------------------------------------------------------------------
// Verification d'un document produit par le systeme.
//
// La camera lit le QR, le serveur en verifie la signature. Un code peut etre
// mathematiquement correct et pourtant ne plus rien designer (employe parti,
// recu supprime) : c'est le serveur qui tranche, jamais le navigateur.
//
// La lecture se fait entierement sur l'appareil : aucune image n'est envoyee,
// seul le texte du QR part au serveur.
// -----------------------------------------------------------------------------

const emit = defineEmits(['close'])

const video = ref(null)
const canvas = ref(null)
const etat = ref('demarrage') // demarrage | scan | verification | resultat | erreur
const messageErreur = ref('')
const resultat = ref(null)
const saisieManuelle = ref('')

let flux = null
let animation = null

// Le flux doit etre coupe explicitement : une camera laissee ouverte garde le
// voyant allume et vide la batterie, et l'utilisateur croit etre espionne.
function arreterCamera() {
  cancelAnimationFrame(animation)
  animation = null
  if (flux) {
    flux.getTracks().forEach((piste) => piste.stop())
    flux = null
  }
}

async function demarrer() {
  etat.value = 'demarrage'
  messageErreur.value = ''
  resultat.value = null

  if (!navigator.mediaDevices?.getUserMedia) {
    etat.value = 'erreur'
    messageErreur.value = "Ce navigateur ne donne pas acces a la camera. Saisissez le code a la main."
    return
  }

  try {
    flux = await navigator.mediaDevices.getUserMedia({
      // Camera arriere : c'est celle qu'on pointe vers un document.
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    etat.value = 'scan'
    await nextTick()
    if (!video.value) return
    video.value.srcObject = flux
    await video.value.play()
    animation = requestAnimationFrame(analyser)
  } catch (err) {
    etat.value = 'erreur'
    // Un message precis vaut mieux qu'un "erreur inconnue" : l'utilisateur doit
    // savoir s'il faut autoriser l'acces ou brancher une camera.
    if (err.name === 'NotAllowedError') {
      messageErreur.value = "Acces a la camera refuse. Autorisez-le dans les reglages du navigateur, ou saisissez le code a la main."
    } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      messageErreur.value = "Aucune camera detectee sur cet appareil. Saisissez le code a la main."
    } else {
      messageErreur.value = `Camera indisponible : ${err.message}`
    }
  }
}

function analyser() {
  if (etat.value !== 'scan' || !video.value || !canvas.value) return

  const v = video.value
  if (v.readyState === v.HAVE_ENOUGH_DATA) {
    const c = canvas.value
    c.width = v.videoWidth
    c.height = v.videoHeight
    const contexte = c.getContext('2d', { willReadFrequently: true })
    contexte.drawImage(v, 0, 0, c.width, c.height)

    const image = contexte.getImageData(0, 0, c.width, c.height)
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })

    if (code?.data) {
      arreterCamera()
      verifier(code.data)
      return
    }
  }
  animation = requestAnimationFrame(analyser)
}

async function verifier(code) {
  etat.value = 'verification'
  try {
    const { data } = await api.post('/exports/verifier', { code })
    resultat.value = data
    etat.value = 'resultat'
  } catch (err) {
    etat.value = 'erreur'
    messageErreur.value = err.response?.data?.message || 'La verification a echoue'
  }
}

function verifierSaisie() {
  if (!saisieManuelle.value.trim()) return
  verifier(saisieManuelle.value.trim())
}

function recommencer() {
  saisieManuelle.value = ''
  demarrer()
}

function fermer() {
  arreterCamera()
  emit('close')
}

onBeforeUnmount(arreterCamera)

demarrer()
</script>

<template>
  <Modal title="Verifier un document" @close="fermer">
    <div class="stack" style="gap: 15px">
      <p class="small muted">
        Presentez le QR d'un badge ou d'un recu de paie. La lecture se fait sur cet
        appareil : aucune image n'est envoyee, seul le code lu est verifie.
      </p>

      <!-- Scan -->
      <div v-if="etat === 'demarrage' || etat === 'scan'" class="cadre-camera">
        <video ref="video" playsinline muted autoplay />
        <div class="viseur" />
        <p v-if="etat === 'demarrage'" class="etat-camera">
          <span class="spinner" /> Ouverture de la camera...
        </p>
      </div>
      <canvas ref="canvas" hidden />

      <div v-if="etat === 'verification'" class="row" style="justify-content: center; padding: 26px">
        <span class="spinner" /> <span class="ml-2">Verification...</span>
      </div>

      <!-- Erreur d'acces -->
      <p v-if="etat === 'erreur'" class="alert alert-warning">
        <Icon name="warning" :size="16" /><span>{{ messageErreur }}</span>
      </p>

      <!-- Resultat -->
      <template v-if="etat === 'resultat' && resultat">
        <div class="verdict" :class="resultat.valide ? 'est-valide' : 'est-invalide'">
          <Icon :name="resultat.valide ? 'shield' : 'alert'" :size="26" />
          <div>
            <p class="verdict-titre">
              {{ resultat.valide ? 'Document authentique' : 'Document non reconnu' }}
            </p>
            <p class="verdict-detail">
              <template v-if="resultat.valide">
                {{ resultat.type === 'BADGE' ? 'Badge employe' : 'Recu de paiement' }}
                emis par ce systeme.
              </template>
              <template v-else>{{ resultat.raison }}</template>
            </p>
          </div>
        </div>

        <p v-if="resultat.avertissement" class="alert alert-warning">
          <Icon name="warning" :size="16" /><span>{{ resultat.avertissement }}</span>
        </p>

        <!-- Badge -->
        <div v-if="resultat.valide && resultat.type === 'BADGE'" class="fiche-resultat">
          <span class="avatar-resultat">
            <img v-if="resultat.donnees.photo" :src="assetUrl(resultat.donnees.photo)" alt="" />
            <span v-else>
              {{ (resultat.donnees.prenom[0] || '') + (resultat.donnees.nom[0] || '') }}
            </span>
          </span>
          <div style="min-width: 0">
            <p class="resultat-nom">{{ resultat.donnees.prenom }} {{ resultat.donnees.nom }}</p>
            <p class="small muted">
              <span class="mono">{{ resultat.donnees.matricule }}</span>
              <template v-if="resultat.donnees.fonction"> · {{ resultat.donnees.fonction }}</template>
            </p>
            <p class="small muted">
              Employe depuis le {{ formatDateCourt(resultat.donnees.date_embauche) }}
            </p>
            <span class="badge mt-2" :class="resultat.donnees.actif ? 'success' : 'danger'">
              {{ resultat.donnees.actif ? 'En poste' : 'Archive' }}
            </span>
          </div>
        </div>

        <!-- Recu -->
        <div v-if="resultat.valide && resultat.type === 'RECU'" class="fiche-audit">
          <div class="fiche-ligne">
            <span class="fiche-cle">Numero</span>
            <span class="fiche-valeur mono">{{ resultat.donnees.numero_recu }}</span>
          </div>
          <div class="fiche-ligne">
            <span class="fiche-cle">Employe</span>
            <span class="fiche-valeur">
              {{ resultat.donnees.nom_complet_snapshot }}
              <span class="mono muted small">({{ resultat.donnees.matricule_snapshot }})</span>
            </span>
          </div>
          <div class="fiche-ligne">
            <span class="fiche-cle">Montant verse</span>
            <span class="fiche-valeur strong">{{ formatMontant(resultat.donnees.montant) }}</span>
          </div>
          <div class="fiche-ligne">
            <span class="fiche-cle">Nature</span>
            <span class="fiche-valeur">
              <span class="badge" :class="resultat.donnees.est_solde ? 'success' : 'warning'">
                {{ resultat.donnees.est_solde ? 'Solde' : 'Acompte' }}
              </span>
            </span>
          </div>
          <div class="fiche-ligne">
            <span class="fiche-cle">Paye le</span>
            <span class="fiche-valeur">{{ formatDate(resultat.donnees.paye_le) }}</span>
          </div>
          <div class="fiche-ligne">
            <span class="fiche-cle">Periode</span>
            <span class="fiche-valeur">
              {{ formatDateCourt(resultat.donnees.periode_debut) }}
              au {{ formatDateCourt(resultat.donnees.periode_fin) }}
            </span>
          </div>
        </div>
      </template>

      <!-- Saisie manuelle : indispensable quand le QR est abime, la camera
           absente, ou l'acces refuse. -->
      <div v-if="etat !== 'scan' && etat !== 'verification'" class="field">
        <label>Ou saisissez le code a la main</label>
        <div class="row" style="gap: 8px">
          <input
            v-model="saisieManuelle"
            type="text"
            class="flex-1"
            placeholder="MACHIBEL:1:BADGE:..."
            @keyup.enter="verifierSaisie"
          />
          <button type="button" @click="verifierSaisie">Verifier</button>
        </div>
      </div>
    </div>

    <template #footer>
      <button v-if="etat === 'resultat' || etat === 'erreur'" type="button" @click="recommencer">
        <Icon name="refresh" :size="15" /> Scanner un autre document
      </button>
      <button type="button" class="primary" @click="fermer">Fermer</button>
    </template>
  </Modal>
</template>

<style scoped>
.cadre-camera {
  position: relative;
  border-radius: var(--r-md);
  overflow: hidden;
  background: #000;
  aspect-ratio: 4 / 3;
}
.cadre-camera video { display: block; width: 100%; height: 100%; object-fit: cover; }

/* Viseur : sans repere, on ne sait pas ou presenter le code et on tourne le
   telephone dans tous les sens. */
.viseur {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  width: 58%;
  aspect-ratio: 1;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.42);
}

.etat-camera {
  position: absolute;
  inset: auto 0 12px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  font-size: 12.5px;
}

.verdict {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 14px;
  border-radius: var(--r-md);
  border: 1px solid;
}
.verdict.est-valide {
  border-color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
  color: var(--success);
}
.verdict.est-invalide {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}
.verdict-titre { margin: 0; font-size: 15px; font-weight: 680; }
.verdict-detail { margin: 2px 0 0; font-size: 12.5px; color: var(--text-muted); }

.fiche-resultat {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.avatar-resultat {
  flex: none;
  width: 62px;
  height: 62px;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--accent-soft);
  color: var(--accent-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 680;
  text-transform: uppercase;
}
.avatar-resultat img { width: 100%; height: 100%; object-fit: cover; }
.resultat-nom { margin: 0; font-size: 16px; font-weight: 650; color: var(--text-h); }

.fiche-audit { border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
.fiche-ligne { display: flex; align-items: baseline; gap: 13px; padding: 8px 13px; }
.fiche-ligne + .fiche-ligne { border-top: 1px solid var(--border); }
.fiche-cle { flex: none; width: 120px; font-size: 12.5px; color: var(--text-muted); }
.fiche-valeur { flex: 1; min-width: 0; font-size: 13px; color: var(--text-h); overflow-wrap: anywhere; }
.fiche-valeur.strong { font-weight: 680; }

@media (max-width: 700px) {
  .fiche-ligne { flex-direction: column; gap: 2px; }
  .fiche-cle { width: auto; }
}
</style>
