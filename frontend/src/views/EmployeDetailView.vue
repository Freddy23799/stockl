<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import api, { assetUrl } from '../api/client'
import { useModulesStore } from '../stores/modules'
import { useToastStore } from '../stores/toasts'
import { telechargerDocument, nommerDocument, formatTaille } from '../utils/telecharger'
import { formatMontant, formatDate, formatDateCourt } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import StatCard from '../components/ui/StatCard.vue'
import Icon from '../components/ui/Icon.vue'

const route = useRoute()
const router = useRouter()
const modules = useModulesStore()
const toasts = useToastStore()

const employe = ref(null)
const paie = ref(null)
const loading = ref(true)
const erreur = ref('')

const ongletActif = ref('infos')
const onglets = computed(() => [
  { id: 'infos', label: 'Informations', icon: 'idCard' },
  { id: 'carriere', label: 'Carriere', icon: 'trending', count: employe.value?.carriere?.length ?? null },
  { id: 'documents', label: 'Documents', icon: 'clipboard', count: employe.value?.documents?.length ?? null },
  ...(modules.paie ? [{ id: 'paie', label: 'Paie', icon: 'wallet', count: paie.value?.lignes?.length ?? null }] : []),
])

const nomComplet = computed(() =>
  employe.value ? `${employe.value.prenom} ${employe.value.nom}` : ''
)

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get(`/employes/${route.params.id}`)
    employe.value = data
    Object.assign(infos, extraireInfos(data))
    if (modules.paie) {
      const { data: p } = await api.get(`/paie/employes/${route.params.id}/historique`)
      paie.value = p
    }
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

/* --- Onglet Informations -------------------------------------------------- */

const CHAMPS = [
  { cle: 'prenom', label: 'Prenom', groupe: 'Etat civil', requis: true },
  { cle: 'nom', label: 'Nom', groupe: 'Etat civil', requis: true },
  { cle: 'sexe', label: 'Sexe', groupe: 'Etat civil', type: 'select', options: [['', 'Non precise'], ['F', 'Feminin'], ['M', 'Masculin']] },
  { cle: 'date_naissance', label: 'Date de naissance', groupe: 'Etat civil', type: 'date' },
  { cle: 'lieu_naissance', label: 'Lieu de naissance', groupe: 'Etat civil' },
  { cle: 'nationalite', label: 'Nationalite', groupe: 'Etat civil' },
  { cle: 'situation_matrimoniale', label: 'Situation matrimoniale', groupe: 'Etat civil' },
  { cle: 'nombre_enfants', label: "Nombre d'enfants", groupe: 'Etat civil', type: 'number' },

  { cle: 'telephone', label: 'Telephone', groupe: 'Contact' },
  { cle: 'telephone_2', label: 'Second telephone', groupe: 'Contact' },
  { cle: 'email', label: 'Adresse email', groupe: 'Contact', type: 'email' },
  { cle: 'adresse', label: 'Adresse', groupe: 'Contact', large: true },
  { cle: 'quartier', label: 'Quartier', groupe: 'Contact' },
  { cle: 'ville', label: 'Ville', groupe: 'Contact' },

  { cle: 'numero_cni', label: 'Numero de CNI', groupe: "Piece d'identite" },
  { cle: 'cni_date_delivrance', label: 'Delivree le', groupe: "Piece d'identite", type: 'date' },
  { cle: 'cni_lieu_delivrance', label: 'Delivree a', groupe: "Piece d'identite" },
  { cle: 'cni_date_expiration', label: 'Expire le', groupe: "Piece d'identite", type: 'date' },

  { cle: 'urgence_nom', label: 'Personne a prevenir', groupe: 'En cas d\'urgence' },
  { cle: 'urgence_telephone', label: 'Son telephone', groupe: 'En cas d\'urgence' },
  { cle: 'urgence_lien', label: 'Lien de parente', groupe: 'En cas d\'urgence' },

  { cle: 'date_embauche', label: "Date d'embauche", groupe: 'Contrat', type: 'date' },
  { cle: 'type_contrat', label: 'Type de contrat', groupe: 'Contrat', type: 'select', options: [['', 'Non precise'], ['CDI', 'CDI'], ['CDD', 'CDD'], ['Essai', "Periode d'essai"], ['Stage', 'Stage'], ['Prestation', 'Prestation']] },
  { cle: 'numero_securite_sociale', label: 'Numero de securite sociale', groupe: 'Contrat' },
  { cle: 'banque_nom', label: 'Banque', groupe: 'Contrat' },
  { cle: 'banque_numero_compte', label: 'Numero de compte', groupe: 'Contrat' },
  { cle: 'date_sortie', label: 'Date de sortie', groupe: 'Contrat', type: 'date' },
  { cle: 'motif_sortie', label: 'Motif de sortie', groupe: 'Contrat', large: true },
  { cle: 'note', label: 'Note interne', groupe: 'Contrat', large: true, type: 'textarea' },
]

const GROUPES = [...new Set(CHAMPS.map((c) => c.groupe))]

const infos = reactive({})
const enregistrement = ref(false)

function extraireInfos(source) {
  const sortie = {}
  for (const champ of CHAMPS) sortie[champ.cle] = source[champ.cle] ?? ''
  return sortie
}

// Le bouton d'enregistrement ne s'active que s'il y a vraiment quelque chose a
// enregistrer : sans cela on ne sait jamais si une modification a ete prise.
const modifie = computed(() => {
  if (!employe.value) return false
  return CHAMPS.some((c) => String(infos[c.cle] ?? '') !== String(employe.value[c.cle] ?? ''))
})

async function enregistrerInfos() {
  enregistrement.value = true
  try {
    await api.put(`/employes/${route.params.id}`, infos)
    toasts.succes('Fiche mise a jour')
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur lors de l\'enregistrement')
  } finally {
    enregistrement.value = false
  }
}

/* --- Photo ---------------------------------------------------------------- */

const photoEnvoi = ref(false)

async function envoyerPhoto(evenement) {
  const fichier = evenement.target.files?.[0]
  if (!fichier) return
  photoEnvoi.value = true
  try {
    const corps = new FormData()
    corps.append('photo', fichier)
    await api.post(`/employes/${route.params.id}/photo`, corps)
    toasts.succes('Photo mise a jour')
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || "Erreur lors de l'envoi")
  } finally {
    photoEnvoi.value = false
    evenement.target.value = ''
  }
}

/* --- Onglet Carriere ------------------------------------------------------ */

const carriereVisible = ref(false)
const carriereMode = ref('ajout')
const carriere = reactive({ montant: '', fonction_id: '', date_debut: '', motif: '', changerFonction: false })

// Les fonctions proposees viennent de la table de reference : la saisie libre
// recreerait les doublons d'orthographe que cette table existe pour empecher.
const fonctions = ref([])

async function chargerFonctions() {
  try {
    const { data } = await api.get('/employes/fonctions')
    fonctions.value = data
  } catch {
    // Non bloquant : le champ reste vide et le formulaire le signale.
  }
}
const carriereErreur = ref('')
const carriereSoumission = ref(false)

const periodeCourante = computed(() =>
  employe.value?.carriere?.find((c) => !c.date_fin) || null
)

function ouvrirCarriere(mode) {
  carriereMode.value = mode
  carriereErreur.value = ''
  const courante = periodeCourante.value
  Object.assign(carriere, {
    montant: mode === 'correction' ? Number(courante?.montant ?? '') : '',
    fonction_id: courante?.fonction_id || '',
    date_debut: new Date().toISOString().slice(0, 10),
    motif: '',
    changerFonction: false,
  })
  carriereVisible.value = true
  chargerFonctions()
}

async function soumettreCarriere() {
  carriereErreur.value = ''
  carriereSoumission.value = true
  try {
    if (carriereMode.value === 'ajout') {
      await api.post(`/employes/${route.params.id}/carriere`, {
        montant: Number(carriere.montant),
        // La fonction n'est envoyee que si on a demande a la changer : sinon le
        // serveur reprend celle de la periode qui se termine.
        fonction_id: carriere.changerFonction ? Number(carriere.fonction_id) : undefined,
        date_debut: carriere.date_debut,
        motif: carriere.motif,
      })
      toasts.succes('Nouvelle periode de carriere enregistree')
    } else {
      await api.put(`/employes/${route.params.id}/carriere/${periodeCourante.value.id}`, {
        montant: Number(carriere.montant),
        fonction_id: carriere.changerFonction ? Number(carriere.fonction_id) : undefined,
        motif: carriere.motif,
      })
      toasts.succes('Periode en cours corrigee')
    }
    carriereVisible.value = false
    await charger()
  } catch (err) {
    carriereErreur.value = err.response?.data?.message || 'Erreur'
  } finally {
    carriereSoumission.value = false
  }
}

// Variation par rapport a la periode precedente : c'est la lecture qui compte
// dans un historique de salaire.
function variation(index) {
  const liste = employe.value?.carriere || []
  const precedente = liste[index + 1]
  if (!precedente) return null
  const avant = Number(precedente.montant)
  const apres = Number(liste[index].montant)
  if (!avant) return null
  return ((apres - avant) / avant) * 100
}

/* --- Onglet Documents ----------------------------------------------------- */

const documentVisible = ref(false)
const documentForm = reactive({ nom: '', categorie: 'autre', note: '' })
const documentFichiers = ref([])
const documentErreur = ref('')
const documentSoumission = ref(false)
const aSupprimer = ref(null)

const CATEGORIES = [
  ['contrat', 'Contrat'], ['identite', "Piece d'identite"], ['diplome', 'Diplome'],
  ['certificat', 'Certificat'], ['medical', 'Medical'], ['bancaire', 'Bancaire'], ['autre', 'Autre'],
]

function ouvrirDocument() {
  Object.assign(documentForm, { nom: '', categorie: 'autre', note: '' })
  documentFichiers.value = []
  documentErreur.value = ''
  documentVisible.value = true
}

function choisirFichiers(evenement) {
  // On ajoute au lieu de remplacer : on selectionne souvent les pages d'un
  // contrat en plusieurs fois, ou on complete avec une photo prise ensuite.
  documentFichiers.value = [...documentFichiers.value, ...Array.from(evenement.target.files || [])]
  evenement.target.value = ''
}

function retirerFichier(index) {
  documentFichiers.value.splice(index, 1)
}

async function soumettreDocument() {
  if (!documentForm.nom.trim()) {
    documentErreur.value = 'Donnez un nom a ce document'
    return
  }
  if (!documentFichiers.value.length) {
    documentErreur.value = 'Ajoutez au moins un fichier'
    return
  }
  documentErreur.value = ''
  documentSoumission.value = true
  try {
    const corps = new FormData()
    corps.append('nom', documentForm.nom.trim())
    corps.append('categorie', documentForm.categorie)
    if (documentForm.note) corps.append('note', documentForm.note)
    for (const f of documentFichiers.value) corps.append('fichiers', f)

    await api.post(`/employes/${route.params.id}/documents`, corps)
    toasts.succes(`Document « ${documentForm.nom} » ajoute`)
    documentVisible.value = false
    await charger()
  } catch (err) {
    documentErreur.value = err.response?.data?.message || "Erreur lors de l'envoi"
  } finally {
    documentSoumission.value = false
  }
}

async function supprimerDocument() {
  const doc = aSupprimer.value
  aSupprimer.value = null
  try {
    await api.delete(`/employes/${route.params.id}/documents/${doc.id}`)
    toasts.succes('Document supprime')
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  }
}

// Gain obtenu par la reduction, affiche seulement quand il est reel : annoncer
// "0 % economise" sur un PDF non compressible n'apprend rien.
function gain(fichier) {
  const origine = Number(fichier.taille_origine || 0)
  const finale = Number(fichier.taille_octets || 0)
  if (!origine || finale >= origine) return null
  return Math.round(((origine - finale) / origine) * 100)
}

function estImage(fichier) {
  return /^image\//.test(fichier.type_mime || '')
}

/* --- Badge ---------------------------------------------------------------- */

async function telechargerBadge() {
  await telechargerDocument('/exports/badges.pdf', {
    params: { employe_id: route.params.id },
    libelle: `Badge ${employe.value?.matricule}`,
    nomFichier: nommerDocument(`badge-${employe.value?.matricule}`),
  })
}

async function telechargerRecu(numero) {
  await telechargerDocument(`/exports/recus/${numero}.pdf`, {
    libelle: `Recu ${numero}`,
    nomFichier: nommerDocument(`recu-${numero}`),
  })
}

onMounted(charger)
</script>

<template>
  <div>
    <div class="row mb-3">
      <RouterLink to="/employes" class="btn btn-sm btn-ghost">
        <Icon name="chevronLeft" :size="15" /> Tous les employes
      </RouterLink>
    </div>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div v-if="loading" class="card"><div class="card-body"><div class="skeleton" style="height: 80px" /></div></div>

    <template v-else-if="employe">
      <!-- Bandeau d'identite -->
      <div class="card mb-4">
        <div class="card-body entete-employe">
          <label class="photo-zone" :class="{ 'est-occupee': photoEnvoi }">
            <img v-if="employe.photo" :src="assetUrl(employe.photo)" alt="" />
            <span v-else class="photo-initiales">
              {{ (employe.prenom[0] || '') + (employe.nom[0] || '') }}
            </span>
            <span class="photo-action">
              <span v-if="photoEnvoi" class="spinner" />
              <Icon v-else name="image" :size="15" />
            </span>
            <input type="file" accept="image/png,image/jpeg" hidden @change="envoyerPhoto" />
          </label>

          <div class="flex-1" style="min-width: 0">
            <div class="row wrap" style="gap: 8px">
              <h1 class="titre-employe">{{ nomComplet }}</h1>
              <span v-if="!employe.actif" class="badge danger">Archive</span>
              <span v-if="employe.vendeuse_code" class="badge accent">
                <Icon name="cart" :size="12" /> Code vente {{ employe.vendeuse_code }}
              </span>
            </div>
            <p class="sous-titre-employe">
              {{ employe.fonction || 'Fonction non definie' }}
              <template v-if="employe.type_contrat"> — {{ employe.type_contrat }}</template>
            </p>
            <div class="row wrap mt-2" style="gap: 14px">
              <span class="info-cle"><span class="muted">Matricule</span> <span class="matricule">{{ employe.matricule }}</span></span>
              <span v-if="employe.telephone" class="info-cle"><span class="muted">Tel.</span> {{ employe.telephone }}</span>
              <span class="info-cle"><span class="muted">Depuis le</span> {{ formatDateCourt(employe.date_embauche) }}</span>
            </div>
          </div>

          <div class="row wrap" style="gap: 8px">
            <button v-if="modules.badges" type="button" @click="telechargerBadge">
              <Icon name="idCard" :size="15" /> Badge
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-stats mb-4">
        <StatCard
          label="Salaire en cours"
          :value="employe.salaire_actuel ? formatMontant(employe.salaire_actuel) : 'Non defini'"
          icon="wallet"
          tone="accent"
          :hint="employe.salaire_depuis ? `Depuis le ${formatDateCourt(employe.salaire_depuis)}` : null"
        />
        <StatCard
          label="Periodes de carriere"
          :value="employe.carriere.length"
          icon="trending"
          hint="Salaires et fonctions successifs"
        />
        <StatCard label="Documents au dossier" :value="employe.documents.length" icon="clipboard" />
        <StatCard
          v-if="modules.paie && paie"
          label="Total percu"
          :value="formatMontant(paie.masse_salariale_versee)"
          icon="banknote"
          tone="success"
          hint="Depuis son arrivee"
        />
      </div>

      <Tabs v-model="ongletActif" :tabs="onglets" />

      <!-- ============ Informations ============ -->
      <div v-show="ongletActif === 'infos'" class="stack">
        <div v-for="groupe in GROUPES" :key="groupe" class="card">
          <div class="card-head">
            <div class="card-head-text"><h2>{{ groupe }}</h2></div>
          </div>
          <div class="card-body">
            <div class="grid-champs">
              <div
                v-for="champ in CHAMPS.filter((c) => c.groupe === groupe)"
                :key="champ.cle"
                class="field"
                :class="{ 'champ-large': champ.large }"
              >
                <label>
                  {{ champ.label }}
                  <span v-if="champ.requis" class="champ-requis">*</span>
                </label>
                <select v-if="champ.type === 'select'" v-model="infos[champ.cle]">
                  <option v-for="[valeur, texte] in champ.options" :key="valeur" :value="valeur">{{ texte }}</option>
                </select>
                <textarea v-else-if="champ.type === 'textarea'" v-model="infos[champ.cle]" rows="2" />
                <input v-else v-model="infos[champ.cle]" :type="champ.type || 'text'" />
              </div>
            </div>
          </div>
        </div>

        <div class="barre-enregistrement" :class="{ 'est-visible': modifie }">
          <span class="small">Des modifications non enregistrees</span>
          <div class="row" style="gap: 8px">
            <button type="button" @click="Object.assign(infos, extraireInfos(employe))">Annuler</button>
            <button type="button" class="primary" :disabled="enregistrement" @click="enregistrerInfos">
              <span v-if="enregistrement" class="spinner" />
              <Icon v-else name="check" :size="15" />
              Enregistrer
            </button>
          </div>
        </div>
      </div>

      <!-- ============ Carriere ============ -->
      <div v-show="ongletActif === 'carriere'" class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Historique de carriere</h2>
            <p class="card-head-sub">
              Chaque periode dit ce qui etait verse, a quel titre, et entre quelles dates.
              Les periodes closes ne sont plus modifiables : des bulletins de paie ont pu
              etre etablis sur leur base.
            </p>
          </div>
          <div class="row wrap" style="gap: 8px">
            <button v-if="periodeCourante" type="button" @click="ouvrirCarriere('correction')">
              <Icon name="edit" :size="15" /> Corriger la periode en cours
            </button>
            <button type="button" class="primary" @click="ouvrirCarriere('ajout')">
              <Icon name="plus" :size="15" /> Nouvelle periode
            </button>
          </div>
        </div>

        <div class="card-body card-body-flush">
          <EmptyState
            v-if="!employe.carriere.length"
            icon="trending"
            title="Aucune periode"
            desc="Ajoutez une periode pour definir le salaire et la fonction."
          />
          <div v-else class="table-wrap">
            <table class="table-cards">
              <thead>
                <tr>
                  <th>Periode</th>
                  <th>Fonction</th>
                  <th class="td-num">Salaire</th>
                  <th class="td-num hide-sm">Variation</th>
                  <th class="hide-sm">Motif</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in employe.carriere" :key="c.id" :class="{ 'est-courante': !c.date_fin }">
                  <td data-label="Periode" class="td-titre">
                    <span class="td-strong">{{ formatDateCourt(c.date_debut) }}</span>
                    <span class="muted"> → </span>
                    <span v-if="c.date_fin">{{ formatDateCourt(c.date_fin) }}</span>
                    <span v-else class="badge success">en cours</span>
                  </td>
                  <td data-label="Fonction"><span class="badge">{{ c.fonction }}</span></td>
                  <td data-label="Salaire" class="td-num tnum td-strong">{{ formatMontant(c.montant) }}</td>
                  <td data-label="Variation" class="td-num hide-sm">
                    <span
                      v-if="variation(i) !== null"
                      class="badge"
                      :class="variation(i) > 0 ? 'success' : (variation(i) < 0 ? 'danger' : '')"
                    >
                      {{ variation(i) > 0 ? '+' : '' }}{{ variation(i).toFixed(1) }} %
                    </span>
                    <span v-else class="muted small">—</span>
                  </td>
                  <td data-label="Motif" class="muted small hide-sm">{{ c.motif || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ============ Documents ============ -->
      <div v-show="ongletActif === 'documents'" class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Pieces du dossier</h2>
            <p class="card-head-sub">
              Un document porte un nom et peut regrouper plusieurs fichiers : un contrat
              numerise page par page reste un seul document.
            </p>
          </div>
          <button type="button" class="primary" @click="ouvrirDocument">
            <Icon name="plus" :size="15" /> Ajouter un document
          </button>
        </div>

        <div class="card-body">
          <EmptyState
            v-if="!employe.documents.length"
            icon="clipboard"
            title="Aucun document"
            desc="Contrat, piece d'identite, diplomes : versez ici les pieces du dossier."
          >
            <button type="button" class="primary" @click="ouvrirDocument">
              <Icon name="plus" :size="15" /> Ajouter un document
            </button>
          </EmptyState>

          <div v-else class="stack" style="gap: 12px">
            <div v-for="doc in employe.documents" :key="doc.id" class="document">
              <div class="document-tete">
                <div style="min-width: 0">
                  <div class="row" style="gap: 8px">
                    <span class="td-strong">{{ doc.nom }}</span>
                    <span v-if="doc.categorie" class="badge">{{ doc.categorie }}</span>
                  </div>
                  <div class="small muted mt-1">
                    {{ doc.fichiers.length }} fichier(s) — ajoute le {{ formatDate(doc.created_at) }}
                    <template v-if="doc.note"> — {{ doc.note }}</template>
                  </div>
                </div>
                <button
                  type="button"
                  class="btn-sm btn-ghost"
                  style="color: var(--danger)"
                  title="Supprimer le document"
                  @click="aSupprimer = doc"
                >
                  <Icon name="trash" :size="15" />
                </button>
              </div>

              <div class="fichiers">
                <a
                  v-for="f in doc.fichiers"
                  :key="f.id"
                  class="fichier"
                  :href="assetUrl(f.chemin)"
                  target="_blank"
                  rel="noopener"
                  :title="f.nom_original"
                >
                  <img v-if="estImage(f)" :src="assetUrl(f.chemin)" alt="" />
                  <span v-else class="fichier-icone"><Icon name="receipt" :size="20" /></span>
                  <span class="fichier-nom">{{ f.nom_original }}</span>
                  <span class="fichier-taille">
                    {{ formatTaille(f.taille_octets) }}
                    <span v-if="gain(f)" class="gain">−{{ gain(f) }} %</span>
                  </span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ Paie ============ -->
      <div v-show="ongletActif === 'paie'" class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Bulletins et versements</h2>
            <p class="card-head-sub">Toutes les periodes de paie ou cet employe figure.</p>
          </div>
        </div>
        <div class="card-body card-body-flush">
          <EmptyState
            v-if="!paie || !paie.lignes.length"
            icon="wallet"
            title="Aucun bulletin"
            desc="Cet employe apparaitra ici des le premier cycle de paie qui le concerne."
          />
          <div v-else class="table-wrap">
            <table class="table-cards">
              <thead>
                <tr>
                  <th>Periode</th>
                  <th class="td-num">Net a payer</th>
                  <th class="td-num">Verse</th>
                  <th>Statut</th>
                  <th class="hide-sm">Recus</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in paie.lignes" :key="l.id">
                  <td data-label="Periode" class="td-titre">
                    <div class="td-strong">{{ l.cycle_libelle || l.cycle_reference }}</div>
                    <div class="small muted">
                      {{ formatDateCourt(l.periode_debut) }} au {{ formatDateCourt(l.periode_fin) }}
                    </div>
                  </td>
                  <td data-label="Net a payer" class="td-num tnum">{{ formatMontant(l.net_a_payer) }}</td>
                  <td data-label="Verse" class="td-num tnum td-strong">{{ formatMontant(l.montant_paye) }}</td>
                  <td data-label="Statut">
                    <span
                      class="badge"
                      :class="l.statut === 'paye' ? 'success' : (l.statut === 'partiel' ? 'warning' : 'danger')"
                    >
                      {{ l.statut === 'paye' ? 'Solde' : (l.statut === 'partiel' ? 'Partiel' : 'Non paye') }}
                    </span>
                  </td>
                  <td data-label="Recus" class="hide-sm">
                    <div class="row wrap" style="gap: 5px">
                      <button
                        v-for="v in l.versements"
                        :key="v.id"
                        type="button"
                        class="btn-sm btn-ghost recu-lien"
                        :title="`${formatMontant(v.montant)} le ${formatDate(v.paye_le)}`"
                        @click="telechargerRecu(v.numero_recu)"
                      >
                        <Icon name="download" :size="13" /> {{ v.numero_recu }}
                      </button>
                      <span v-if="!l.versements.length" class="small muted">Aucun</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ Modale carriere ============ -->
    <Modal
      v-if="carriereVisible"
      :title="carriereMode === 'ajout' ? 'Nouvelle periode de carriere' : 'Corriger la periode en cours'"
      @close="carriereVisible = false"
    >
      <form id="form-carriere" @submit.prevent="soumettreCarriere">
        <p class="small muted mb-3">
          <template v-if="carriereMode === 'ajout'">
            La periode en cours sera close la veille de la date choisie, et conservee.
            C'est ce qu'il faut faire pour une augmentation ou une promotion.
          </template>
          <template v-else>
            Rectifie la periode en cours sans en creer de nouvelle. A reserver aux
            erreurs de saisie : l'historique ne gardera pas trace de l'ancienne valeur.
          </template>
        </p>

        <div class="field-row">
          <div class="field">
            <label>Salaire mensuel</label>
            <input v-model="carriere.montant" type="number" min="0" step="1" required />
          </div>
          <div v-if="carriereMode === 'ajout'" class="field">
            <label>A compter du</label>
            <input v-model="carriere.date_debut" type="date" required />
          </div>
        </div>

        <!-- Le salaire et la fonction avancent ensemble, mais l'un peut changer
             sans l'autre : d'ou l'interrupteur plutot qu'un champ toujours actif. -->
        <div class="field">
          <label class="row" style="gap: 8px; cursor: pointer">
            <input v-model="carriere.changerFonction" type="checkbox" style="width: auto" />
            <span>Changer aussi la fonction</span>
          </label>
          <select v-if="carriere.changerFonction" v-model="carriere.fonction_id" class="mt-2">
            <option value="" disabled>Choisir une fonction</option>
            <option v-for="f in fonctions" :key="f.id" :value="f.id">{{ f.nom }}</option>
          </select>
          <span v-else class="field-hint">
            Reste « {{ periodeCourante?.fonction || 'non definie' }} »
          </span>
        </div>

        <div class="field">
          <label>Motif <span class="muted">(optionnel)</span></label>
          <input v-model="carriere.motif" type="text" maxlength="200" placeholder="Promotion, revalorisation, correction..." />
        </div>

        <p v-if="carriereErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ carriereErreur }}</span>
        </p>
      </form>

      <template #footer>
        <button type="button" @click="carriereVisible = false">Annuler</button>
        <button type="submit" form="form-carriere" class="primary" :disabled="carriereSoumission">
          <span v-if="carriereSoumission" class="spinner" />
          {{ carriereMode === 'ajout' ? 'Ajouter la periode' : 'Corriger' }}
        </button>
      </template>
    </Modal>

    <!-- ============ Modale document ============ -->
    <Modal v-if="documentVisible" title="Ajouter un document" @close="documentVisible = false">
      <form id="form-document" @submit.prevent="soumettreDocument">
        <div class="field">
          <label>Nom du document <span class="champ-requis">*</span></label>
          <input v-model="documentForm.nom" type="text" maxlength="150" required placeholder="Contrat de travail" />
        </div>

        <div class="field-row">
          <div class="field">
            <label>Categorie</label>
            <select v-model="documentForm.categorie">
              <option v-for="[valeur, texte] in CATEGORIES" :key="valeur" :value="valeur">{{ texte }}</option>
            </select>
          </div>
          <div class="field">
            <label>Note <span class="muted">(optionnel)</span></label>
            <input v-model="documentForm.note" type="text" maxlength="300" />
          </div>
        </div>

        <div class="field">
          <label>Fichiers <span class="champ-requis">*</span></label>
          <div class="row wrap" style="gap: 8px">
            <label class="btn">
              <Icon name="clipboard" :size="15" /> Choisir des fichiers
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple hidden @change="choisirFichiers" />
            </label>
            <!-- `capture` ouvre directement l'appareil photo sur mobile : c'est
                 le geste naturel pour verser une piece papier au dossier. -->
            <label class="btn">
              <Icon name="image" :size="15" /> Photographier
              <input type="file" accept="image/*" capture="environment" multiple hidden @change="choisirFichiers" />
            </label>
          </div>
          <span class="field-hint">
            Images et PDF, 5 Mo par fichier. Les images sont automatiquement reduites.
          </span>
        </div>

        <ul v-if="documentFichiers.length" class="liste-fichiers">
          <li v-for="(f, i) in documentFichiers" :key="i">
            <Icon :name="/^image\//.test(f.type) ? 'image' : 'receipt'" :size="15" />
            <span class="flex-1" style="min-width: 0; overflow: hidden; text-overflow: ellipsis">{{ f.name }}</span>
            <span class="small muted">{{ formatTaille(f.size) }}</span>
            <button type="button" class="icon-btn" title="Retirer" @click="retirerFichier(i)">
              <Icon name="x" :size="14" />
            </button>
          </li>
        </ul>

        <p v-if="documentErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ documentErreur }}</span>
        </p>
      </form>

      <template #footer>
        <button type="button" @click="documentVisible = false">Annuler</button>
        <button type="submit" form="form-document" class="primary" :disabled="documentSoumission">
          <span v-if="documentSoumission" class="spinner" />
          Enregistrer le document
        </button>
      </template>
    </Modal>

    <ConfirmDialog
      v-if="aSupprimer"
      title="Supprimer ce document ?"
      :message="`« ${aSupprimer.nom} » et ses ${aSupprimer.fichiers.length} fichier(s) seront definitivement effaces. Cette action est irreversible.`"
      confirm-label="Supprimer"
      @confirm="supprimerDocument"
      @cancel="aSupprimer = null"
    />
  </div>
</template>

<style scoped>
.entete-employe { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }

.titre-employe { margin: 0; font-size: 21px; font-weight: 680; letter-spacing: -0.02em; color: var(--text-h); }
.sous-titre-employe { margin: 3px 0 0; font-size: 13px; color: var(--text-muted); }
.info-cle { font-size: 12.5px; color: var(--text-h); }

.photo-zone {
  position: relative;
  flex: none;
  width: 88px;
  height: 88px;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--accent-soft);
  color: var(--accent-text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid var(--border);
}
.photo-zone img { width: 100%; height: 100%; object-fit: cover; }
.photo-initiales { font-size: 30px; font-weight: 680; text-transform: uppercase; }
.photo-action {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}
.photo-zone.est-occupee { opacity: 0.6; pointer-events: none; }

.matricule {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  font-family: var(--mono);
  font-weight: 650;
  letter-spacing: 0.04em;
}

.grid-champs {
  display: grid;
  gap: 13px 15px;
  /* `minmax(0, 1fr)` et non `1fr` : la borne basse de `1fr` est la largeur du
     contenu, ce qui fait deborder la grille sur un champ au texte long. */
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
}
.champ-large { grid-column: 1 / -1; }
.champ-requis { color: var(--danger); margin-left: 2px; }

.est-courante { background: var(--accent-soft); }

/* Barre d'enregistrement qui n'apparait qu'en cas de modification : on sait
   toujours s'il reste quelque chose a valider avant de quitter la page. */
.barre-enregistrement {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--accent);
  border-radius: var(--r-md);
  background: var(--bg-card, #fff);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.14));
  opacity: 0;
  transform: translateY(8px);
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.barre-enregistrement.est-visible { opacity: 1; transform: none; pointer-events: auto; }

.document { border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
.document-tete {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.fichiers {
  display: grid;
  gap: 9px;
  grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr));
  padding: 12px 13px;
}
.fichier {
  display: block;
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 6px);
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  background: var(--bg-subtle);
}
.fichier:hover { border-color: var(--accent); }
.fichier img { display: block; width: 100%; height: 88px; object-fit: cover; }
.fichier-icone {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88px;
  color: var(--text-muted);
}
.fichier-nom {
  display: block;
  padding: 6px 8px 0;
  font-size: 11.5px;
  font-weight: 550;
  color: var(--text-h);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fichier-taille {
  display: flex;
  gap: 6px;
  padding: 1px 8px 7px;
  font-size: 10.5px;
  color: var(--text-muted);
}
.gain { color: var(--success); font-weight: 650; }

.liste-fichiers { list-style: none; margin: 10px 0 0; padding: 0; }
.liste-fichiers li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 6px);
  font-size: 12.5px;
}
.liste-fichiers li + li { margin-top: 6px; }

.recu-lien { font-family: var(--mono); font-size: 11px; }
</style>
