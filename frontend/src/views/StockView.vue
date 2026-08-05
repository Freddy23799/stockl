<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api, { assetUrl } from '../api/client'
import { useModulesStore } from '../stores/modules'
import { useToastStore } from '../stores/toasts'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import Pagination from '../components/ui/Pagination.vue'
import Icon from '../components/ui/Icon.vue'

const modules = useModulesStore()
const toasts = useToastStore()

const etatStock = ref([])
const produits = ref([])
const fournisseurs = ref([])
const mouvements = ref([])
const loading = ref(true)
const chargementMouvements = ref(false)
const erreur = ref('')

const ongletActif = ref('etat')
const recherche = ref('')

const enAlerte = computed(() => etatStock.value.filter((p) => p.en_alerte))
const valeurTotale = computed(() =>
  etatStock.value.reduce((s, p) => s + Number(p.quantite_stock) * Number(p.cout_moyen_pondere), 0)
)
const ruptures = computed(() => etatStock.value.filter((p) => Number(p.quantite_stock) <= 0))

const onglets = computed(() => [
  { id: 'etat', label: 'Etat du stock', icon: 'layers', count: etatStock.value.length },
  { id: 'mouvements', label: 'Mouvements', icon: 'history', count: total.value },
])

const etatFiltre = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  if (!q) return etatStock.value
  return etatStock.value.filter((p) => p.nom.toLowerCase().includes(q))
})

/* --- Chargement --------------------------------------------------------- */

const filtres = reactive({ produit_id: '', type: '', from: '', to: '' })
const page = ref(1)
const pageSize = 20
const total = ref(0)

async function chargerEtat() {
  const { data } = await api.get('/stock')
  etatStock.value = data
}

async function chargerMouvements() {
  chargementMouvements.value = true
  try {
    const params = { page: page.value, pageSize }
    if (filtres.produit_id) params.produit_id = filtres.produit_id
    if (filtres.type) params.type = filtres.type
    if (filtres.from) params.from = filtres.from
    if (filtres.to) params.to = filtres.to
    const { data } = await api.get('/stock/mouvements', { params })
    mouvements.value = data.data
    total.value = data.total
  } finally {
    chargementMouvements.value = false
  }
}

function filtrerMouvements() {
  page.value = 1
  chargerMouvements()
}

function reinitialiserFiltres() {
  Object.assign(filtres, { produit_id: '', type: '', from: '', to: '' })
  filtrerMouvements()
}

const filtresActifs = computed(() =>
  Boolean(filtres.produit_id || filtres.type || filtres.from || filtres.to)
)

function changerPage(nouvellePage) {
  page.value = nouvellePage
  chargerMouvements()
}

async function chargerReferences() {
  const appels = [api.get('/produits')]
  if (modules.fournisseurs) appels.push(api.get('/fournisseurs'))
  const [produitsRes, fournisseursRes] = await Promise.all(appels)
  produits.value = produitsRes.data
  fournisseurs.value = fournisseursRes ? fournisseursRes.data : []
}

onMounted(async () => {
  loading.value = true
  erreur.value = ''
  try {
    await Promise.all([chargerEtat(), chargerMouvements(), chargerReferences()])
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
})

/* --- Entree de stock ---------------------------------------------------- */

const entreeVisible = ref(false)
const entree = reactive({ produit_id: '', quantite_achat: '', cout_achat_total: '', fournisseur_id: '' })
const entreeErreur = ref('')
const entreeSoumission = ref(false)

const produitEntree = computed(() =>
  produits.value.find((p) => p.id === Number(entree.produit_id)) || null
)

// Le prix se saisit pour le lot entier, alors que le stock se compte a l'unite
// de reference. Afficher le cout unitaire resultant evite de decouvrir une
// erreur de saisie plus tard, dans les marges.
const apercuEntree = computed(() => {
  const p = produitEntree.value
  const q = Number(entree.quantite_achat)
  const cout = Number(entree.cout_achat_total)
  if (!p || !(q > 0) || !(cout >= 0)) return null
  const quantiteRef = q * Number(p.facteur_conversion)
  if (!(quantiteRef > 0)) return null
  return {
    quantiteRef,
    uniteRef: p.unite_stock,
    coutUnitaire: cout / quantiteRef,
    nouveauStock: Number(p.quantite_stock) + quantiteRef,
  }
})

function ouvrirEntree(produitId = '') {
  Object.assign(entree, { produit_id: produitId, quantite_achat: '', cout_achat_total: '', fournisseur_id: '' })
  entreeErreur.value = ''
  entreeVisible.value = true
}

async function soumettreEntree() {
  entreeErreur.value = ''
  entreeSoumission.value = true
  try {
    await api.post('/stock/entrees', {
      produit_id: Number(entree.produit_id),
      quantite_achat: Number(entree.quantite_achat),
      cout_achat_total: Number(entree.cout_achat_total),
      fournisseur_id: modules.fournisseurs && entree.fournisseur_id ? Number(entree.fournisseur_id) : null,
    })
    entreeVisible.value = false
    toasts.succes(`Stock de "${produitEntree.value?.nom}" reapprovisionne`)
    await Promise.all([chargerEtat(), chargerMouvements(), chargerReferences()])
  } catch (err) {
    entreeErreur.value = err.response?.data?.message || 'Erreur lors de l\'entree de stock'
  } finally {
    entreeSoumission.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="Stock" subtitle="Etat en temps reel et journal de tous les mouvements d'entree et de sortie.">
      <template #actions>
        <button type="button" class="primary" @click="ouvrirEntree()">
          <Icon name="boxIn" :size="15" /> Entree de stock
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
          <span class="stat-label">Valeur immobilisee</span>
        </div>
        <div class="stat-value">{{ formatMontant(valeurTotale) }}</div>
        <div class="stat-foot">Au cout moyen pondere</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon" :class="enAlerte.length ? 'is-warning' : 'is-success'">
            <Icon name="warning" :size="15" />
          </span>
          <span class="stat-label">Sous le seuil</span>
        </div>
        <div class="stat-value">{{ enAlerte.length }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon" :class="ruptures.length ? 'is-danger' : 'is-success'">
            <Icon name="inbox" :size="15" />
          </span>
          <span class="stat-label">En rupture</span>
        </div>
        <div class="stat-value">{{ ruptures.length }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon"><Icon name="layers" :size="15" /></span>
          <span class="stat-label">References suivies</span>
        </div>
        <div class="stat-value">{{ etatStock.length }}</div>
      </div>
    </div>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <!-- ============ Etat du stock ============ -->
    <div v-show="ongletActif === 'etat'" class="card">
      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input v-model="recherche" type="search" placeholder="Rechercher un produit..." />
        </div>
        <span class="small muted">{{ etatFiltre.length }} produit(s)</span>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="6" :cols="5" />

        <EmptyState
          v-else-if="!etatFiltre.length && recherche"
          icon="search"
          title="Aucun resultat"
          :desc="`Aucun produit ne correspond a « ${recherche} ».`"
        >
          <button type="button" @click="recherche = ''">Effacer la recherche</button>
        </EmptyState>

        <EmptyState
          v-else-if="!etatFiltre.length"
          icon="layers"
          title="Aucun produit en stock"
          desc="Creez d'abord des produits, puis enregistrez une entree de stock."
        />

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th style="width: 46px"></th>
                <th>Produit</th>
                <th class="td-num">Stock</th>
                <th class="td-num">Seuil</th>
                <th class="td-num hide-sm">Cout moyen</th>
                <th class="td-num">Valeur</th>
                <th class="td-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in etatFiltre" :key="p.id">
                <td data-label="">
                  <img v-if="p.photo" :src="assetUrl(p.photo)" class="thumb" alt="" />
                  <div v-else class="thumb"><Icon name="image" :size="15" /></div>
                </td>
                <td data-label="Produit" class="td-titre td-strong">{{ p.nom }}</td>
                <td data-label="Stock" class="td-num">
                  <span class="badge" :class="Number(p.quantite_stock) <= 0 ? 'danger' : p.en_alerte ? 'warning' : 'success'">
                    {{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }}
                  </span>
                </td>
                <td data-label="Seuil" class="td-num tnum muted">{{ formatQuantite(p.seuil_alerte) }}</td>
                <td data-label="Cout moyen" class="td-num tnum hide-sm">{{ formatMontant(p.cout_moyen_pondere) }}</td>
                <td data-label="Valeur" class="td-num tnum td-strong">
                  {{ formatMontant(Number(p.quantite_stock) * Number(p.cout_moyen_pondere)) }}
                </td>
                <td data-label="" class="td-actions">
                  <button type="button" class="btn-sm" @click="ouvrirEntree(p.id)">
                    <Icon name="plus" :size="14" /> Reapprovisionner
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============ Mouvements ============ -->
    <div v-show="ongletActif === 'mouvements'" class="card">
      <div class="card-head">
        <div class="toolbar flex-1">
          <div class="field">
            <label>Produit</label>
            <select v-model="filtres.produit_id" @change="filtrerMouvements">
              <option value="">Tous</option>
              <option v-for="p in produits" :key="p.id" :value="p.id">{{ p.nom }}</option>
            </select>
          </div>
          <div class="field">
            <label>Type</label>
            <select v-model="filtres.type" @change="filtrerMouvements">
              <option value="">Tous</option>
              <option value="entree">Entrees</option>
              <option value="sortie">Sorties</option>
            </select>
          </div>
          <div class="field">
            <label>Du</label>
            <input v-model="filtres.from" type="date" @change="filtrerMouvements" />
          </div>
          <div class="field">
            <label>Au</label>
            <input v-model="filtres.to" type="date" @change="filtrerMouvements" />
          </div>
          <button v-if="filtresActifs" type="button" class="btn-ghost" @click="reinitialiserFiltres">
            <Icon name="x" :size="14" /> Effacer
          </button>
        </div>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="chargementMouvements" :rows="6" :cols="5" />

        <EmptyState
          v-else-if="!mouvements.length"
          icon="history"
          :title="filtresActifs ? 'Aucun mouvement sur ces criteres' : 'Aucun mouvement'"
          :desc="filtresActifs ? 'Elargissez la periode ou retirez des filtres.' : 'Chaque entree et chaque vente laisse une trace ici.'"
        >
          <button v-if="filtresActifs" type="button" @click="reinitialiserFiltres">Effacer les filtres</button>
        </EmptyState>

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Type</th>
                <th class="td-num">Quantite</th>
                <th class="td-num">Cout unitaire</th>
                <th v-if="modules.fournisseurs" class="hide-sm">Fournisseur</th>
                <th class="td-num">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in mouvements" :key="m.id">
                <td data-label="Produit" class="td-titre td-strong">{{ m.produit_nom }}</td>
                <td data-label="Type">
                  <span class="badge" :class="m.type === 'entree' ? 'success' : 'warning'">
                    <Icon :name="m.type === 'entree' ? 'boxIn' : 'boxOut'" :size="12" />
                    {{ m.type === 'entree' ? 'Entree' : 'Sortie' }}
                  </span>
                </td>
                <td data-label="Quantite" class="td-num tnum td-strong">{{ formatQuantite(m.quantite) }}</td>
                <td data-label="Cout unitaire" class="td-num tnum muted">{{ formatMontant(m.cout_unitaire) }}</td>
                <td v-if="modules.fournisseurs" data-label="Fournisseur" class="muted hide-sm">{{ m.fournisseur_nom || '—' }}</td>
                <td data-label="Date" class="td-num small muted nowrap">{{ formatDate(m.date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="mouvements.length" class="card-foot">
        <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="changerPage" />
      </div>
    </div>

    <!-- ============ Modale entree de stock ============ -->
    <Modal v-if="entreeVisible" title="Entree de stock" @close="entreeVisible = false">
      <form id="form-entree" @submit.prevent="soumettreEntree">
        <div class="field">
          <label>Produit</label>
          <select v-model="entree.produit_id" required>
            <option value="" disabled>Choisir un produit</option>
            <option v-for="p in produits" :key="p.id" :value="p.id">
              {{ p.nom }} — {{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }} en stock
            </option>
          </select>
        </div>

        <div class="field-row">
          <div class="field">
            <label>
              Quantite achetee
              <span v-if="produitEntree" class="muted">({{ produitEntree.unite_achat || produitEntree.unite_stock }})</span>
            </label>
            <input v-model="entree.quantite_achat" type="number" min="0.01" step="0.01" required />
          </div>
          <div class="field">
            <label>Cout d'achat total</label>
            <input v-model="entree.cout_achat_total" type="number" min="0" step="0.01" required />
            <span class="field-hint">Prix paye pour tout le lot</span>
          </div>
        </div>

        <div v-if="modules.fournisseurs" class="field">
          <label>Fournisseur <span class="muted">(optionnel)</span></label>
          <select v-model="entree.fournisseur_id">
            <option value="">Aucun</option>
            <option v-for="f in fournisseurs" :key="f.id" :value="f.id">{{ f.nom }}</option>
          </select>
        </div>

        <div v-if="apercuEntree" class="alert alert-info">
          <Icon name="info" :size="16" />
          <span>
            Ajoute <strong>{{ formatQuantite(apercuEntree.quantiteRef) }} {{ apercuEntree.uniteRef }}</strong>
            au stock, a <strong>{{ formatMontant(apercuEntree.coutUnitaire) }}</strong> l'unite.
            Nouveau stock : <strong>{{ formatQuantite(apercuEntree.nouveauStock) }} {{ apercuEntree.uniteRef }}</strong>.
          </span>
        </div>

        <p v-if="entreeErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ entreeErreur }}</span>
        </p>
      </form>

      <template #footer>
        <button type="button" @click="entreeVisible = false">Annuler</button>
        <button type="submit" form="form-entree" class="primary" :disabled="entreeSoumission">
          <span v-if="entreeSoumission" class="spinner" />
          Enregistrer l'entree
        </button>
      </template>
    </Modal>
  </div>
</template>
