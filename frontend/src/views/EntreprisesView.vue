<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../api/client'
import { useToastStore } from '../stores/toasts'
import { formatDate } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import Modal from '../components/ui/Modal.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import Icon from '../components/ui/Icon.vue'

const toasts = useToastStore()

const entreprises = ref([])
const loading = ref(true)
const erreur = ref('')

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get('/entreprises')
    entreprises.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

onMounted(charger)

const actives = computed(() => entreprises.value.filter((e) => e.actif).length)

/* --- Creation ------------------------------------------------------------ */

const formVisible = ref(false)
const soumission = ref(false)
const formErreur = ref('')
const entrepriseCreee = ref(null)
const form = reactive({ nom: '', admin_prenom: '', admin_nom: '' })

function ouvrirCreation() {
  Object.assign(form, { nom: '', admin_prenom: '', admin_nom: '' })
  formErreur.value = ''
  entrepriseCreee.value = null
  formVisible.value = true
}

function fermerCreation() {
  entrepriseCreee.value = null
  formVisible.value = false
}

async function creer() {
  soumission.value = true
  formErreur.value = ''
  try {
    const { data } = await api.post('/entreprises', form)
    entrepriseCreee.value = data
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de la creation'
  } finally {
    soumission.value = false
  }
}

async function copier(texte, libelle) {
  try {
    await navigator.clipboard.writeText(texte)
    toasts.succes(`${libelle} copie`)
  } catch {
    toasts.erreur('Copie impossible sur ce navigateur')
  }
}

/* --- Activation ------------------------------------------------------------ */

const aBasculer = ref(null)
const bascule = ref(false)
const motifBlocage = ref('')

async function basculer(e) {
  bascule.value = true
  const action = e.actif ? 'bloquer' : 'reactiver'
  try {
    await api.patch(`/entreprises/${e.id}/${action}`, e.actif ? { motif: motifBlocage.value } : undefined)
    toasts.succes(e.actif ? `"${e.nom}" est bloquee` : `"${e.nom}" est debloquee`)
    aBasculer.value = null
    motifBlocage.value = ''
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  } finally {
    bascule.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Entreprises clientes"
      subtitle="Creer et gerer les entreprises de la plateforme. Reserve a l'operateur."
    >
      <template #actions>
        <button type="button" class="primary" @click="ouvrirCreation">
          <Icon name="plus" :size="15" /> Nouvelle entreprise
        </button>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <p class="alert alert-warning mb-4">
      <Icon name="warning" :size="16" />
      <span>
        Une entreprise nouvellement creee n'est pas encore utilisable : ses ecrans metier ne
        filtrent pas tous encore par entreprise, et la connexion de son admin est bloquee tant que
        ce travail n'est pas termine.
      </span>
    </p>

    <div class="grid grid-stats mb-4">
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon is-accent"><Icon name="building" :size="15" /></span>
          <span class="stat-label">Entreprises</span>
        </div>
        <div class="stat-value">{{ entreprises.length }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon"><Icon name="check" :size="15" /></span>
          <span class="stat-label">Actives</span>
        </div>
        <div class="stat-value">{{ actives }}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <span class="small muted">{{ entreprises.length }} entreprise(s)</span>
      </div>
      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="4" :cols="4" />

        <EmptyState
          v-else-if="!entreprises.length"
          icon="building"
          title="Aucune entreprise"
          desc="Creez la premiere entreprise cliente de la plateforme."
        >
          <button type="button" class="primary" @click="ouvrirCreation">
            <Icon name="plus" :size="15" /> Nouvelle entreprise
          </button>
        </EmptyState>

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th>Entreprise</th>
                <th class="td-num">Comptes</th>
                <th>Creee le</th>
                <th>Statut</th>
                <th class="td-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in entreprises" :key="e.id">
                <td data-label="Entreprise" class="td-titre">
                  <div class="td-strong">{{ e.nom }}</div>
                  <div class="small muted">{{ e.slug }}</div>
                </td>
                <td data-label="Comptes" class="td-num tnum">{{ e.nombre_comptes }}</td>
                <td data-label="Creee le" class="small muted nowrap">{{ formatDate(e.created_at) }}</td>
                <td data-label="Statut">
                  <span class="badge" :class="e.actif ? 'success' : 'danger'">{{ e.actif ? 'Active' : 'Bloquee' }}</span>
                </td>
                <td data-label="" class="td-actions">
                  <button
                    v-if="e.actif"
                    type="button"
                    class="btn-sm btn-ghost"
                    title="Bloquer l'entreprise"
                    style="color: var(--danger)"
                    @click="aBasculer = e"
                  >
                    <Icon name="trash" :size="15" />
                  </button>
                  <button v-else type="button" class="btn-sm" :disabled="bascule" @click="basculer(e)">
                    Debloquer
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Creation -->
    <Modal v-if="formVisible" title="Nouvelle entreprise" @close="fermerCreation">
      <form v-if="!entrepriseCreee" id="form-entreprise" @submit.prevent="creer">
        <div class="field">
          <label>Nom de l'entreprise</label>
          <input v-model="form.nom" placeholder="Boulangerie du Centre" required />
        </div>
        <div class="field-row">
          <div class="field">
            <label>Prenom de l'administrateur</label>
            <input v-model="form.admin_prenom" required />
          </div>
          <div class="field">
            <label>Nom de l'administrateur</label>
            <input v-model="form.admin_nom" required />
          </div>
        </div>
        <p class="alert alert-info">
          <Icon name="info" :size="16" />
          <span>
            L'identifiant de connexion et le mot de passe de ce premier compte administrateur sont
            generes automatiquement et affiches une seule fois a la creation.
          </span>
        </p>
        <p v-if="formErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ formErreur }}</span>
        </p>
      </form>

      <div v-else class="stack">
        <p>
          Entreprise <strong>{{ entrepriseCreee.entreprise.nom }}</strong> creee, avec son premier
          compte administrateur. Notez ces identifiants et transmettez-les :
          <strong>ils ne seront plus jamais affiches</strong>.
        </p>

        <div class="identifiants">
          <div class="identifiant-ligne">
            <span class="small muted">Identifiant</span>
            <div class="row" style="gap: 8px">
              <code class="identifiant-valeur">{{ entrepriseCreee.admin.nom_utilisateur }}</code>
              <button type="button" class="btn-sm btn-ghost" title="Copier" @click="copier(entrepriseCreee.admin.nom_utilisateur, 'Identifiant')">
                <Icon name="copy" :size="15" />
              </button>
            </div>
          </div>
          <div class="identifiant-ligne">
            <span class="small muted">Mot de passe</span>
            <div class="row" style="gap: 8px">
              <code class="identifiant-valeur">{{ entrepriseCreee.admin.mot_de_passe_initial }}</code>
              <button type="button" class="btn-sm btn-ghost" title="Copier" @click="copier(entrepriseCreee.admin.mot_de_passe_initial, 'Mot de passe')">
                <Icon name="copy" :size="15" />
              </button>
            </div>
          </div>
        </div>

        <p class="alert alert-warning">
          <Icon name="warning" :size="16" />
          <span>
            Cette entreprise n'est pas encore utilisable de bout en bout : ne transmettez pas
            encore ces identifiants tant que l'isolation des donnees n'est pas terminee.
          </span>
        </p>
      </div>

      <template #footer>
        <template v-if="!entrepriseCreee">
          <button type="button" @click="fermerCreation">Annuler</button>
          <button type="submit" form="form-entreprise" class="primary" :disabled="soumission">
            <span v-if="soumission" class="spinner" />
            Creer l'entreprise
          </button>
        </template>
        <button v-else type="button" class="primary" @click="fermerCreation">J'ai note ces identifiants</button>
      </template>
    </Modal>

    <Modal
      v-if="aBasculer"
      title="Bloquer cette entreprise ?"
      @close="aBasculer = null"
    >
      <p class="alert alert-warning">
        <Icon name="warning" :size="16" />
        Tous les comptes de « {{ aBasculer.nom }} » perdront immediatement l'acces. Apres deblocage, ils devront se reconnecter.
      </p>
      <div class="field">
        <label>Motif du blocage</label>
        <textarea v-model="motifBlocage" rows="3" required placeholder="Ex. Abonnement impaye, incident de securite..." />
      </div>
      <template #footer>
        <button type="button" @click="aBasculer = null">Annuler</button>
        <button type="button" class="btn-danger-solid" :disabled="bascule || !motifBlocage.trim()" @click="basculer(aBasculer)">
          <span v-if="bascule" class="spinner" /> Bloquer l'entreprise
        </button>
      </template>
    </Modal>
  </div>
</template>
