<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../api/client'
import { useToastStore } from '../stores/toasts'
import { formatMontant, formatDate } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import Icon from '../components/ui/Icon.vue'

const toasts = useToastStore()

const depenses = ref([])
const loading = ref(true)
const erreur = ref('')

const ongletActif = ref('liste')
const recherche = ref('')
const filtres = reactive({ from: '', to: '', categorie: '' })

const filtresActifs = computed(() => Boolean(filtres.from || filtres.to || filtres.categorie))

const totalAffiche = computed(() => depenses.value.reduce((s, d) => s + Number(d.montant), 0))

const moyenne = computed(() =>
  depenses.value.length ? totalAffiche.value / depenses.value.length : 0
)

// Regroupement par categorie calcule sur les lignes deja chargees : pas d'appel
// supplementaire au serveur, et le resultat suit automatiquement les filtres.
const parCategorie = computed(() => {
  const map = new Map()
  for (const d of depenses.value) {
    const cle = d.categorie || 'Sans categorie'
    const actuel = map.get(cle) || { categorie: cle, total: 0, nombre: 0 }
    actuel.total += Number(d.montant)
    actuel.nombre += 1
    map.set(cle, actuel)
  }
  return Array.from(map.values())
    .map((c) => ({ ...c, part: totalAffiche.value > 0 ? c.total / totalAffiche.value : 0 }))
    .sort((a, b) => b.total - a.total)
})

const categoriesConnues = computed(() =>
  [...new Set(depenses.value.map((d) => d.categorie).filter(Boolean))].sort()
)

const depensesAffichees = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  if (!q) return depenses.value
  return depenses.value.filter(
    (d) => d.categorie.toLowerCase().includes(q) || (d.note || '').toLowerCase().includes(q)
  )
})

const onglets = computed(() => [
  { id: 'liste', label: 'Depenses', icon: 'receipt', count: depenses.value.length },
  { id: 'categories', label: 'Par categorie', icon: 'chart', count: parCategorie.value.length },
])

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const params = {}
    if (filtres.from) params.from = filtres.from
    if (filtres.to) params.to = filtres.to
    if (filtres.categorie) params.categorie = filtres.categorie
    const { data } = await api.get('/depenses', { params })
    depenses.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

function reinitialiserFiltres() {
  Object.assign(filtres, { from: '', to: '', categorie: '' })
  charger()
}

onMounted(charger)

/* --- Saisie ------------------------------------------------------------- */

const formVisible = ref(false)
const form = reactive({ categorie: '', montant: '', note: '' })
const formErreur = ref('')
const soumission = ref(false)

function ouvrirForm() {
  Object.assign(form, { categorie: '', montant: '', note: '' })
  formErreur.value = ''
  formVisible.value = true
}

async function soumettre() {
  formErreur.value = ''
  soumission.value = true
  try {
    await api.post('/depenses', {
      categorie: form.categorie.trim(),
      montant: Number(form.montant),
      note: form.note.trim() || null,
    })
    formVisible.value = false
    toasts.succes(`Depense de ${formatMontant(form.montant)} enregistree`)
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement'
  } finally {
    soumission.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="Depenses" subtitle="Toutes les sorties d'argent hors achat de marchandise. Elles sont deduites du bilan net.">
      <template #actions>
        <button type="button" class="primary" @click="ouvrirForm">
          <Icon name="plus" :size="15" /> Nouvelle depense
        </button>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div class="grid grid-stats mb-4">
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon is-warning"><Icon name="receipt" :size="15" /></span>
          <span class="stat-label">Total sur la periode</span>
        </div>
        <div class="stat-value">{{ formatMontant(totalAffiche) }}</div>
        <div class="stat-foot">{{ depenses.length }} depense(s)</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon"><Icon name="chart" :size="15" /></span>
          <span class="stat-label">Depense moyenne</span>
        </div>
        <div class="stat-value">{{ formatMontant(moyenne) }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon"><Icon name="tag" :size="15" /></span>
          <span class="stat-label">Categories</span>
        </div>
        <div class="stat-value">{{ parCategorie.length }}</div>
        <div v-if="parCategorie.length" class="stat-foot">Principale : {{ parCategorie[0].categorie }}</div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-body">
        <div class="toolbar">
          <div class="field">
            <label>Categorie</label>
            <input v-model="filtres.categorie" list="categories-connues" placeholder="Toutes" @change="charger" />
            <datalist id="categories-connues">
              <option v-for="c in categoriesConnues" :key="c" :value="c" />
            </datalist>
          </div>
          <div class="field">
            <label>Du</label>
            <input v-model="filtres.from" type="date" @change="charger" />
          </div>
          <div class="field">
            <label>Au</label>
            <input v-model="filtres.to" type="date" @change="charger" />
          </div>
          <button v-if="filtresActifs" type="button" class="btn-ghost" @click="reinitialiserFiltres">
            <Icon name="x" :size="14" /> Effacer
          </button>
        </div>
      </div>
    </div>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <!-- ============ Liste ============ -->
    <div v-show="ongletActif === 'liste'" class="card">
      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input v-model="recherche" type="search" placeholder="Rechercher une categorie ou une note..." />
        </div>
        <span class="small muted">{{ depensesAffichees.length }} ligne(s)</span>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="6" :cols="4" />

        <EmptyState
          v-else-if="!depensesAffichees.length && recherche"
          icon="search"
          title="Aucun resultat"
          :desc="`Rien ne correspond a « ${recherche} ».`"
        >
          <button type="button" @click="recherche = ''">Effacer la recherche</button>
        </EmptyState>

        <EmptyState
          v-else-if="!depensesAffichees.length"
          icon="receipt"
          :title="filtresActifs ? 'Aucune depense sur ces criteres' : 'Aucune depense'"
          :desc="filtresActifs ? 'Elargissez la periode ou changez de categorie.' : 'Loyer, electricite, transport... enregistrez-les pour un bilan juste.'"
        >
          <button v-if="filtresActifs" type="button" @click="reinitialiserFiltres">Effacer les filtres</button>
          <button v-else type="button" class="primary" @click="ouvrirForm">
            <Icon name="plus" :size="15" /> Enregistrer une depense
          </button>
        </EmptyState>

        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categorie</th>
                <th>Note</th>
                <th class="td-num">Montant</th>
                <th class="td-num">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in depensesAffichees" :key="d.id">
                <td><span class="badge accent">{{ d.categorie }}</span></td>
                <td class="muted">{{ d.note || '—' }}</td>
                <td class="td-num td-strong tnum">{{ formatMontant(d.montant) }}</td>
                <td class="td-num small muted nowrap">{{ formatDate(d.date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="depensesAffichees.length" class="card-foot">
        <span class="small muted">Total affiche</span>
        <span class="strong tnum">{{ formatMontant(totalAffiche) }}</span>
      </div>
    </div>

    <!-- ============ Par categorie ============ -->
    <div v-show="ongletActif === 'categories'" class="card">
      <div class="card-head">
        <div class="card-head-text">
          <h2>Repartition des depenses</h2>
          <p class="card-head-sub">Sur la periode filtree, de la plus lourde a la plus legere</p>
        </div>
      </div>
      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="4" :cols="4" />
        <EmptyState
          v-else-if="!parCategorie.length"
          icon="chart"
          title="Rien a repartir"
          desc="Aucune depense sur la periode selectionnee."
        />
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categorie</th>
                <th style="width: 34%">Part</th>
                <th class="td-num">Nombre</th>
                <th class="td-num">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in parCategorie" :key="c.categorie">
                <td class="td-strong">{{ c.categorie }}</td>
                <td>
                  <div class="row" style="gap: 9px">
                    <div class="barre-piste">
                      <div class="barre-valeur" :style="{ width: `${Math.max(2, c.part * 100)}%` }" />
                    </div>
                    <span class="small muted tnum nowrap">{{ (c.part * 100).toFixed(1) }}%</span>
                  </div>
                </td>
                <td class="td-num tnum muted">{{ c.nombre }}</td>
                <td class="td-num td-strong tnum">{{ formatMontant(c.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============ Modale de saisie ============ -->
    <Modal v-if="formVisible" title="Nouvelle depense" @close="formVisible = false">
      <form id="form-depense" @submit.prevent="soumettre">
        <div class="field-row">
          <div class="field">
            <label>Categorie</label>
            <input
              v-model="form.categorie"
              list="categories-connues"
              placeholder="electricite, loyer, transport..."
              required
            />
            <span class="field-hint">Reutilisez les memes libelles pour des rapports lisibles</span>
          </div>
          <div class="field">
            <label>Montant</label>
            <input v-model="form.montant" type="number" min="0" step="0.01" required />
          </div>
        </div>
        <div class="field">
          <label>Note <span class="muted">(optionnel)</span></label>
          <input v-model="form.note" placeholder="Facture de janvier, course au marche..." />
        </div>
        <p v-if="formErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ formErreur }}</span>
        </p>
      </form>
      <template #footer>
        <button type="button" @click="formVisible = false">Annuler</button>
        <button type="submit" form="form-depense" class="primary" :disabled="soumission">
          <span v-if="soumission" class="spinner" />
          Enregistrer
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.barre-piste {
  flex: 1;
  height: 7px;
  border-radius: var(--r-full);
  background: var(--bg-subtle);
  overflow: hidden;
}
.barre-valeur {
  height: 100%;
  border-radius: var(--r-full);
  background: var(--accent);
}
</style>
