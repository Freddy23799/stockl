<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../api/client'
import { useToastStore } from '../stores/toasts'
import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import StatCard from '../components/ui/StatCard.vue'
import Icon from '../components/ui/Icon.vue'

const toasts = useToastStore()

const vendeuses = ref([])
const loading = ref(true)
const erreur = ref('')

const ongletActif = ref('actives')
const recherche = ref('')

const actives = computed(() => vendeuses.value.filter((v) => v.actif))
const inactives = computed(() => vendeuses.value.filter((v) => !v.actif))

const onglets = computed(() => [
  { id: 'actives', label: 'Actives', icon: 'users', count: actives.value.length },
  { id: 'archivees', label: 'Desactivees', icon: 'inbox', count: inactives.value.length },
])

const vendeusesAffichees = computed(() => {
  const liste = ongletActif.value === 'archivees' ? inactives.value : actives.value
  const q = recherche.value.trim().toLowerCase()
  if (!q) return liste
  return liste.filter(
    (v) => v.nom.toLowerCase().includes(q) || String(v.code).includes(q)
  )
})

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    // Les deux onglets se lisent depuis une seule liste : le tri actif/inactif
    // se fait en memoire plutot qu'en rechargeant a chaque bascule.
    const { data } = await api.get('/vendeuses', { params: { includeInactifs: true } })
    vendeuses.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

onMounted(charger)

async function copierCode(code) {
  try {
    await navigator.clipboard.writeText(String(code))
    toasts.succes(`Code ${code} copie`)
  } catch {
    toasts.erreur('Copie impossible sur ce navigateur')
  }
}

/* --- Creation / edition -------------------------------------------------- */

const formVisible = ref(false)
const modeEdition = ref(false)
const soumission = ref(false)
const formErreur = ref('')
const form = reactive({ id: null, nom: '', contact: '' })
const dernierCodeCree = ref(null)

function ouvrirCreation() {
  modeEdition.value = false
  formErreur.value = ''
  dernierCodeCree.value = null
  Object.assign(form, { id: null, nom: '', contact: '' })
  formVisible.value = true
}

function ouvrirEdition(v) {
  modeEdition.value = true
  formErreur.value = ''
  dernierCodeCree.value = null
  Object.assign(form, { id: v.id, nom: v.nom, contact: v.contact || '' })
  formVisible.value = true
}

async function soumettreForm() {
  soumission.value = true
  formErreur.value = ''
  try {
    const payload = { nom: form.nom, contact: form.contact || null }
    if (modeEdition.value) {
      await api.put(`/vendeuses/${form.id}`, payload)
      formVisible.value = false
      toasts.succes(`"${payload.nom}" mis a jour`)
    } else {
      const { data } = await api.post('/vendeuses', payload)
      // La modale reste ouverte : le code genere ne s'affiche qu'une fois ici,
      // il faut pouvoir le lire et le copier avant de fermer.
      dernierCodeCree.value = data.code
    }
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement'
  } finally {
    soumission.value = false
  }
}

/* --- Activation ---------------------------------------------------------- */

const aDesactiver = ref(null)
const bascule = ref(false)

async function basculerActivation(v) {
  const action = v.actif ? 'desactiver' : 'activer'
  bascule.value = true
  try {
    await api.patch(`/vendeuses/${v.id}/${action}`)
    toasts.succes(v.actif ? `"${v.nom}" desactivee` : `"${v.nom}" reactivee`)
    aDesactiver.value = null
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
      title="Vendeuses"
      subtitle="Une vendeuse n'a pas de compte de connexion : son code a 6 chiffres, permanent, l'identifie au moment d'enregistrer une vente."
    >
      <template #actions>
        <button type="button" class="primary" @click="ouvrirCreation">
          <Icon name="userPlus" :size="15" /> Nouvelle vendeuse
        </button>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div class="grid grid-stats mb-4">
      <StatCard label="Vendeuses" :value="vendeuses.length" icon="users" tone="accent" hint="Toutes fiches confondues" />
      <StatCard label="Actives" :value="actives.length" icon="check" tone="success" hint="Peuvent encaisser" />
      <StatCard label="Desactivees" :value="inactives.length" icon="inbox" hint="Code refuse a la caisse" />
    </div>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <div class="card">
      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input v-model="recherche" type="search" placeholder="Rechercher par nom ou code..." />
        </div>
        <span class="small muted">{{ vendeusesAffichees.length }} affichee(s)</span>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="5" :cols="4" />

        <EmptyState
          v-else-if="!vendeusesAffichees.length && recherche"
          icon="search"
          title="Aucun resultat"
          :desc="`Aucune vendeuse ne correspond a « ${recherche} ».`"
        >
          <button type="button" @click="recherche = ''">Effacer la recherche</button>
        </EmptyState>

        <EmptyState
          v-else-if="!vendeusesAffichees.length && ongletActif === 'actives'"
          icon="users"
          title="Aucune vendeuse active"
          desc="Creez une fiche : le code a 6 chiffres est genere automatiquement et ne change jamais."
        >
          <button type="button" class="primary" @click="ouvrirCreation">
            <Icon name="userPlus" :size="15" /> Creer la premiere vendeuse
          </button>
        </EmptyState>

        <EmptyState
          v-else-if="!vendeusesAffichees.length"
          icon="inbox"
          title="Aucune vendeuse desactivee"
          desc="Les fiches desactivees restent ici : leur historique de ventes est conserve."
        />

        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Nom</th>
                <th>Contact</th>
                <th>Statut</th>
                <th class="td-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in vendeusesAffichees" :key="v.id">
                <td>
                  <div class="row">
                    <span class="code-cell">{{ v.code }}</span>
                    <button
                      type="button"
                      class="btn-sm btn-ghost"
                      title="Copier le code"
                      @click="copierCode(v.code)"
                    >
                      <Icon name="copy" :size="15" />
                    </button>
                  </div>
                </td>
                <td class="td-strong">{{ v.nom }}</td>
                <td class="muted">{{ v.contact || '—' }}</td>
                <td>
                  <span class="badge" :class="v.actif ? 'success' : 'danger'">
                    <span class="badge-dot" />{{ v.actif ? 'Active' : 'Desactivee' }}
                  </span>
                </td>
                <td class="td-actions">
                  <button type="button" class="btn-sm btn-ghost" title="Modifier" @click="ouvrirEdition(v)">
                    <Icon name="edit" :size="15" />
                  </button>
                  <button
                    v-if="v.actif"
                    type="button"
                    class="btn-sm btn-ghost"
                    title="Desactiver"
                    style="color: var(--danger)"
                    @click="aDesactiver = v"
                  >
                    <Icon name="toggle" :size="15" />
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn-sm"
                    :disabled="bascule"
                    @click="basculerActivation(v)"
                  >
                    <Icon name="refresh" :size="14" /> Reactiver
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
      :title="dernierCodeCree ? 'Vendeuse creee' : modeEdition ? 'Modifier la vendeuse' : 'Nouvelle vendeuse'"
      @close="formVisible = false"
    >
      <template v-if="dernierCodeCree">
        <div class="code-panel">
          <p class="small muted">Code d'identification de {{ form.nom }}</p>
          <p class="code-big">{{ dernierCodeCree }}</p>
          <button type="button" class="btn-sm" @click="copierCode(dernierCodeCree)">
            <Icon name="copy" :size="14" /> Copier le code
          </button>
        </div>
        <p class="alert alert-info mt-4">
          <Icon name="info" :size="16" />
          <span>Ce code est permanent. Communiquez-le a la vendeuse : elle le donnera a chaque vente qui doit lui etre attribuee.</span>
        </p>
      </template>

      <form v-else id="form-vendeuse" @submit.prevent="soumettreForm">
        <div class="field">
          <label>Nom</label>
          <input v-model="form.nom" placeholder="Prenom et nom" required />
        </div>
        <div class="field">
          <label>Contact <span class="muted">(optionnel)</span></label>
          <input v-model="form.contact" placeholder="Telephone ou adresse" />
          <span class="field-hint">Utile pour la joindre, jamais utilise pour se connecter</span>
        </div>
        <p v-if="formErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ formErreur }}</span>
        </p>
      </form>

      <template #footer>
        <template v-if="dernierCodeCree">
          <button type="button" class="primary" @click="formVisible = false">Termine</button>
        </template>
        <template v-else>
          <button type="button" @click="formVisible = false">Annuler</button>
          <button type="submit" form="form-vendeuse" class="primary" :disabled="soumission">
            <span v-if="soumission" class="spinner" />
            {{ modeEdition ? 'Enregistrer' : 'Creer la vendeuse' }}
          </button>
        </template>
      </template>
    </Modal>

    <ConfirmDialog
      v-if="aDesactiver"
      title="Desactiver cette vendeuse ?"
      :message="`Le code de « ${aDesactiver.nom} » sera refuse a la caisse. Ses ventes passees restent dans l'historique et la fiche peut etre reactivee a tout moment.`"
      confirm-label="Desactiver"
      :busy="bascule"
      @confirm="basculerActivation(aDesactiver)"
      @cancel="aDesactiver = null"
    />
  </div>
</template>

<style scoped>
/* Le code est l'information la plus lue de la page : chiffres monospaces et
   espaces pour eviter toute confusion entre 0/O et 1/l a la dictee. */
.code-cell {
  font-family: var(--mono);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--text-h);
}

.code-panel {
  text-align: center;
  padding: 20px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}
.code-big {
  font-family: var(--mono);
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--text-h);
  margin: 6px 0 12px;
}
@media (max-width: 480px) {
  .code-big { font-size: 30px; }
}
</style>
