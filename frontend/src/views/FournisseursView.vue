<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../api/client'
import { useToastStore } from '../stores/toasts'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import Icon from '../components/ui/Icon.vue'

const toasts = useToastStore()

const tous = ref([])
const loading = ref(true)
const erreur = ref('')

const ongletActif = ref('actifs')
const recherche = ref('')

const plage = reactive({ from: '', to: '' })
const periodeActive = ref(false)

const actifs = computed(() => tous.value.filter((f) => f.actif))
const inactifs = computed(() => tous.value.filter((f) => !f.actif))

const onglets = computed(() => [
  { id: 'actifs', label: 'Actifs', icon: 'truck', count: actifs.value.length },
  { id: 'inactifs', label: 'Desactives', icon: 'inbox', count: inactifs.value.length },
])

const montantGlobal = computed(() => tous.value.reduce((s, f) => s + Number(f.montant_total || 0), 0))
const achatsGlobaux = computed(() => tous.value.reduce((s, f) => s + Number(f.nombre_achats || 0), 0))
const principal = computed(() =>
  [...tous.value].sort((a, b) => Number(b.montant_total || 0) - Number(a.montant_total || 0))[0] || null
)

const listeAffichee = computed(() => {
  const base = ongletActif.value === 'inactifs' ? inactifs.value : actifs.value
  const q = recherche.value.trim().toLowerCase()
  const filtree = q
    ? base.filter((f) => f.nom.toLowerCase().includes(q) || (f.contact || '').toLowerCase().includes(q))
    : [...base]
  return filtree.sort((a, b) => Number(b.montant_total || 0) - Number(a.montant_total || 0))
})

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const params = {}
    if (plage.from && plage.to) {
      params.from = plage.from
      params.to = plage.to
    }
    const { data } = await api.get('/fournisseurs/totaux', { params })
    tous.value = data
    periodeActive.value = Boolean(plage.from && plage.to)
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

function reinitialiserPeriode() {
  plage.from = ''
  plage.to = ''
  charger()
}

function classeVariation(v) {
  if (v > 0) return 'success'
  if (v < 0) return 'danger'
  return ''
}

onMounted(charger)

/* --- Creation / edition ------------------------------------------------- */

const formVisible = ref(false)
const modeEdition = ref(false)
const soumission = ref(false)
const formErreur = ref('')
const form = reactive({ id: null, nom: '', contact: '' })

function ouvrirCreation() {
  modeEdition.value = false
  formErreur.value = ''
  Object.assign(form, { id: null, nom: '', contact: '' })
  formVisible.value = true
}

function ouvrirEdition(f) {
  modeEdition.value = true
  formErreur.value = ''
  Object.assign(form, { id: f.id, nom: f.nom, contact: f.contact || '' })
  formVisible.value = true
}

async function soumettreForm() {
  soumission.value = true
  formErreur.value = ''
  try {
    const payload = { nom: form.nom.trim(), contact: form.contact.trim() || null }
    if (modeEdition.value) {
      await api.put(`/fournisseurs/${form.id}`, payload)
      toasts.succes(`"${payload.nom}" mis a jour`)
    } else {
      await api.post('/fournisseurs', payload)
      toasts.succes(`"${payload.nom}" ajoute`)
    }
    formVisible.value = false
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement'
  } finally {
    soumission.value = false
  }
}

/* --- Activation --------------------------------------------------------- */

const aDesactiver = ref(null)
const bascule = ref(false)

async function basculer(f, viaDialogue = false) {
  bascule.value = true
  const action = f.actif ? 'desactiver' : 'activer'
  try {
    await api.patch(`/fournisseurs/${f.id}/${action}`)
    toasts.succes(f.actif ? `"${f.nom}" desactive` : `"${f.nom}" reactive`)
    if (viaDialogue) aDesactiver.value = null
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  } finally {
    bascule.value = false
  }
}

/* --- Historique --------------------------------------------------------- */

const historiqueVisible = ref(false)
const historiqueChargement = ref(false)
const historiqueAchats = ref([])
const historiqueTotal = ref(null)
const historiqueNom = ref('')

async function ouvrirHistorique(f) {
  historiqueVisible.value = true
  historiqueChargement.value = true
  historiqueNom.value = f.nom
  historiqueAchats.value = []
  historiqueTotal.value = null
  try {
    const [histoRes, totalRes] = await Promise.all([
      api.get(`/fournisseurs/${f.id}/historique`),
      api.get(`/fournisseurs/${f.id}/total`),
    ])
    historiqueAchats.value = histoRes.data
    historiqueTotal.value = totalRes.data
  } finally {
    historiqueChargement.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="Fournisseurs" subtitle="Qui vous approvisionne, pour combien, et comment cela evolue d'une periode a l'autre.">
      <template #actions>
        <button type="button" class="primary" @click="ouvrirCreation">
          <Icon name="plus" :size="15" /> Nouveau fournisseur
        </button>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div class="grid grid-stats mb-4">
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon is-accent"><Icon name="wallet" :size="15" /></span>
          <span class="stat-label">Total achete</span>
        </div>
        <div class="stat-value">{{ formatMontant(montantGlobal) }}</div>
        <div class="stat-foot">{{ periodeActive ? 'Sur la periode filtree' : 'Depuis le debut' }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon"><Icon name="boxIn" :size="15" /></span>
          <span class="stat-label">Approvisionnements</span>
        </div>
        <div class="stat-value">{{ achatsGlobaux }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon"><Icon name="building" :size="15" /></span>
          <span class="stat-label">Fournisseur principal</span>
        </div>
        <div class="stat-value" style="font-size: 17px">{{ principal?.nom || '—' }}</div>
        <div v-if="principal" class="stat-foot">{{ formatMontant(principal.montant_total) }}</div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-body">
        <div class="toolbar">
          <div class="field">
            <label>Du</label>
            <input v-model="plage.from" type="date" />
          </div>
          <div class="field">
            <label>Au</label>
            <input v-model="plage.to" type="date" />
          </div>
          <button type="button" :disabled="!plage.from || !plage.to" @click="charger">
            <Icon name="filter" :size="14" /> Comparer sur la periode
          </button>
          <button v-if="periodeActive" type="button" class="btn-ghost" @click="reinitialiserPeriode">
            <Icon name="x" :size="14" /> Effacer
          </button>
          <div class="toolbar-spacer" />
          <span v-if="periodeActive" class="badge info">
            Comparaison active vs periode precedente de meme duree
          </span>
        </div>
      </div>
    </div>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <div class="card">
      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input v-model="recherche" type="search" placeholder="Rechercher un fournisseur..." />
        </div>
        <span class="small muted">{{ listeAffichee.length }} fournisseur(s)</span>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="5" :cols="5" />

        <EmptyState
          v-else-if="!listeAffichee.length && recherche"
          icon="search"
          title="Aucun resultat"
          :desc="`Aucun fournisseur ne correspond a « ${recherche} ».`"
        >
          <button type="button" @click="recherche = ''">Effacer la recherche</button>
        </EmptyState>

        <EmptyState
          v-else-if="!listeAffichee.length && ongletActif === 'actifs'"
          icon="truck"
          title="Aucun fournisseur"
          desc="Rattachez vos entrees de stock a un fournisseur pour suivre vos achats par source."
        >
          <button type="button" class="primary" @click="ouvrirCreation">
            <Icon name="plus" :size="15" /> Ajouter un fournisseur
          </button>
        </EmptyState>

        <EmptyState
          v-else-if="!listeAffichee.length"
          icon="inbox"
          title="Aucun fournisseur desactive"
          desc="Les fournisseurs desactives restent consultables ici."
        />

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th class="td-num">Achats</th>
                <th class="td-num hide-sm">Quantite</th>
                <th class="td-num">Montant</th>
                <th v-if="periodeActive" class="td-num">Variation</th>
                <th class="td-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in listeAffichee" :key="f.id">
                <td data-label="Fournisseur" class="td-titre">
                  <div class="td-strong">{{ f.nom }}</div>
                  <div class="small muted">{{ f.contact || 'Aucun contact' }}</div>
                </td>
                <td data-label="Achats" class="td-num tnum">{{ f.nombre_achats }}</td>
                <td data-label="Quantite" class="td-num tnum muted hide-sm">{{ formatQuantite(f.quantite_totale) }}</td>
                <td data-label="Montant" class="td-num td-strong tnum">{{ formatMontant(f.montant_total) }}</td>
                <td v-if="periodeActive" data-label="Variation" class="td-num">
                  <span
                    v-if="typeof f.variation_pourcentage === 'number'"
                    class="badge"
                    :class="classeVariation(f.variation_pourcentage)"
                  >
                    <Icon
                      :name="f.variation_pourcentage > 0 ? 'arrowUp' : f.variation_pourcentage < 0 ? 'arrowDown' : 'arrowRight'"
                      :size="12"
                    />
                    {{ Math.abs(f.variation_pourcentage).toFixed(1) }}%
                  </span>
                  <span v-else class="muted">—</span>
                </td>
                <td data-label="" class="td-actions">
                  <button type="button" class="btn-sm btn-ghost" title="Historique des achats" @click="ouvrirHistorique(f)">
                    <Icon name="history" :size="15" />
                  </button>
                  <button type="button" class="btn-sm btn-ghost" title="Modifier" @click="ouvrirEdition(f)">
                    <Icon name="edit" :size="15" />
                  </button>
                  <button
                    v-if="f.actif"
                    type="button"
                    class="btn-sm btn-ghost"
                    title="Desactiver"
                    style="color: var(--danger)"
                    @click="aDesactiver = f"
                  >
                    <Icon name="trash" :size="15" />
                  </button>
                  <button v-else type="button" class="btn-sm" :disabled="bascule" @click="basculer(f)">
                    Reactiver
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Creation / edition -->
    <Modal
      v-if="formVisible"
      :title="modeEdition ? 'Modifier le fournisseur' : 'Nouveau fournisseur'"
      @close="formVisible = false"
    >
      <form id="form-fournisseur" @submit.prevent="soumettreForm">
        <div class="field">
          <label>Nom</label>
          <input v-model="form.nom" placeholder="Parfums du Golfe" required />
        </div>
        <div class="field">
          <label>Contact <span class="muted">(optionnel)</span></label>
          <input v-model="form.contact" placeholder="Telephone, email, adresse..." />
        </div>
        <p v-if="formErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ formErreur }}</span>
        </p>
      </form>
      <template #footer>
        <button type="button" @click="formVisible = false">Annuler</button>
        <button type="submit" form="form-fournisseur" class="primary" :disabled="soumission">
          <span v-if="soumission" class="spinner" />
          {{ modeEdition ? 'Enregistrer' : 'Ajouter' }}
        </button>
      </template>
    </Modal>

    <!-- Historique des achats -->
    <Modal
      v-if="historiqueVisible"
      :title="`Achats — ${historiqueNom}`"
      size="lg"
      @close="historiqueVisible = false"
    >
      <TableSkeleton v-if="historiqueChargement" :rows="4" :cols="4" />
      <template v-else>
        <div class="grid grid-stats mb-4">
          <div class="stat">
            <div class="stat-top">
              <span class="stat-icon"><Icon name="boxIn" :size="15" /></span>
              <span class="stat-label">Nombre d'achats</span>
            </div>
            <div class="stat-value">{{ historiqueTotal?.nombre_achats ?? 0 }}</div>
          </div>
          <div class="stat">
            <div class="stat-top">
              <span class="stat-icon is-accent"><Icon name="wallet" :size="15" /></span>
              <span class="stat-label">Montant total</span>
            </div>
            <div class="stat-value">{{ formatMontant(historiqueTotal?.montant_total) }}</div>
          </div>
        </div>

        <EmptyState
          v-if="!historiqueAchats.length"
          icon="inbox"
          title="Aucun achat"
          desc="Aucune entree de stock n'a encore ete rattachee a ce fournisseur."
        />
        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th>Produit</th>
                <th class="td-num">Quantite</th>
                <th class="td-num">Cout unitaire</th>
                <th class="td-num">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in historiqueAchats" :key="a.id">
                <td data-label="Produit" class="td-titre td-strong">{{ a.produit_nom }}</td>
                <td data-label="Quantite" class="td-num tnum">{{ formatQuantite(a.quantite) }}</td>
                <td data-label="Cout unitaire" class="td-num tnum muted">{{ formatMontant(a.cout_unitaire) }}</td>
                <td data-label="Date" class="td-num small muted nowrap">{{ formatDate(a.date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </Modal>

    <ConfirmDialog
      v-if="aDesactiver"
      title="Desactiver ce fournisseur ?"
      :message="`« ${aDesactiver.nom} » ne pourra plus etre selectionne lors d'une entree de stock. Son historique d'achats reste intact et il peut etre reactive a tout moment.`"
      confirm-label="Desactiver"
      :busy="bascule"
      @confirm="basculer(aDesactiver, true)"
      @cancel="aDesactiver = null"
    />
  </div>
</template>
