<script setup>
import { ref, reactive, onMounted } from 'vue'
import api, { assetUrl } from '../api/client'
import { useModulesStore } from '../stores/modules'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'
import Pagination from '../components/Pagination.vue'

const modules = useModulesStore()

const etatStock = ref([])
const produits = ref([])
const fournisseurs = ref([])
const mouvements = ref([])
const loading = ref(true)
const erreur = ref('')

const entree = reactive({ produit_id: '', quantite_achat: '', cout_achat_total: '', fournisseur_id: '' })
const entreeErreur = ref('')
const entreeSoumission = ref(false)

const filtres = reactive({ produit_id: '', type: '', from: '', to: '' })
const page = ref(1)
const pageSize = 20
const total = ref(0)

async function chargerEtat() {
  const { data } = await api.get('/stock')
  etatStock.value = data
}

async function chargerMouvements() {
  const params = { page: page.value, pageSize }
  if (filtres.produit_id) params.produit_id = filtres.produit_id
  if (filtres.type) params.type = filtres.type
  if (filtres.from) params.from = filtres.from
  if (filtres.to) params.to = filtres.to
  const { data } = await api.get('/stock/mouvements', { params })
  mouvements.value = data.data
  total.value = data.total
}

function filtrerMouvements() {
  page.value = 1
  chargerMouvements()
}

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
    Object.assign(entree, { produit_id: '', quantite_achat: '', cout_achat_total: '', fournisseur_id: '' })
    await Promise.all([chargerEtat(), chargerMouvements()])
  } catch (err) {
    entreeErreur.value = err.response?.data?.message || 'Erreur lors de l\'entree de stock'
  } finally {
    entreeSoumission.value = false
  }
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
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Stock</h1>
    </div>

    <p v-if="erreur" class="error-message">{{ erreur }}</p>

    <div class="card">
      <h2>Etat du stock</h2>
      <p v-if="loading">Chargement...</p>
      <table v-else>
        <thead><tr><th></th><th>Produit</th><th>Stock</th><th>Seuil</th><th>Cout moyen pondere</th><th>Statut</th></tr></thead>
        <tbody>
          <tr v-for="p in etatStock" :key="p.id">
            <td><img v-if="p.photo" :src="assetUrl(p.photo)" class="thumb" alt="" /><div v-else class="thumb" /></td>
            <td>{{ p.nom }}</td>
            <td>{{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }}</td>
            <td>{{ formatQuantite(p.seuil_alerte) }}</td>
            <td>{{ formatMontant(p.cout_moyen_pondere) }}</td>
            <td><span class="badge" :class="p.en_alerte ? 'danger' : 'success'">{{ p.en_alerte ? 'Alerte' : 'OK' }}</span></td>
          </tr>
          <tr v-if="!etatStock.length"><td colspan="6">Aucun produit</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Entree de stock (ravitaillement)</h2>
      <form @submit.prevent="soumettreEntree">
        <div class="form-row-inline">
          <div class="form-row" style="flex: 2">
            <label>Produit</label>
            <select v-model="entree.produit_id" required>
              <option value="" disabled>Choisir un produit</option>
              <option v-for="p in produits" :key="p.id" :value="p.id">
                {{ p.nom }} ({{ p.unite_achat || p.unite_stock }})
              </option>
            </select>
          </div>
          <div class="form-row" v-if="modules.fournisseurs">
            <label>Fournisseur (optionnel)</label>
            <select v-model="entree.fournisseur_id">
              <option value="">Aucun</option>
              <option v-for="f in fournisseurs" :key="f.id" :value="f.id">{{ f.nom }}</option>
            </select>
          </div>
        </div>
        <div class="form-row-inline">
          <div class="form-row">
            <label>Quantite achetee (unite d'achat)</label>
            <input v-model="entree.quantite_achat" type="number" min="0.01" step="0.01" required />
          </div>
          <div class="form-row">
            <label>Cout d'achat total</label>
            <input v-model="entree.cout_achat_total" type="number" min="0" step="0.01" required />
          </div>
        </div>
        <p v-if="entreeErreur" class="error-message">{{ entreeErreur }}</p>
        <button type="submit" class="primary" :disabled="entreeSoumission">
          {{ entreeSoumission ? 'Enregistrement...' : 'Enregistrer l\'entree' }}
        </button>
      </form>
    </div>

    <div class="card">
      <h2>Historique des mouvements</h2>
      <div class="toolbar">
        <div class="form-row">
          <label>Produit</label>
          <select v-model="filtres.produit_id">
            <option value="">Tous</option>
            <option v-for="p in produits" :key="p.id" :value="p.id">{{ p.nom }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>Type</label>
          <select v-model="filtres.type">
            <option value="">Tous</option>
            <option value="entree">Entree</option>
            <option value="sortie">Sortie</option>
          </select>
        </div>
        <div class="form-row">
          <label>Du</label>
          <input v-model="filtres.from" type="date" />
        </div>
        <div class="form-row">
          <label>Au</label>
          <input v-model="filtres.to" type="date" />
        </div>
        <div class="form-row" style="justify-content: flex-end">
          <label>&nbsp;</label>
          <button type="button" @click="filtrerMouvements">Filtrer</button>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Produit</th><th>Type</th><th>Quantite</th><th>Cout unitaire</th><th v-if="modules.fournisseurs">Fournisseur</th><th>Date</th></tr>
        </thead>
        <tbody>
          <tr v-for="m in mouvements" :key="m.id">
            <td>{{ m.produit_nom }}</td>
            <td><span class="badge" :class="m.type === 'entree' ? 'success' : 'warning'">{{ m.type }}</span></td>
            <td>{{ formatQuantite(m.quantite) }}</td>
            <td>{{ formatMontant(m.cout_unitaire) }}</td>
            <td v-if="modules.fournisseurs">{{ m.fournisseur_nom || '-' }}</td>
            <td>{{ formatDate(m.date) }}</td>
          </tr>
          <tr v-if="!mouvements.length"><td :colspan="modules.fournisseurs ? 6 : 5">Aucun mouvement</td></tr>
        </tbody>
      </table>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="changerPage" />
    </div>
  </div>
</template>
