<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import api from '../api/client'
import Modal from '../components/Modal.vue'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'

const produits = ref([])
const vendeuses = ref([])
const ventes = ref([])
const loading = ref(true)
const erreur = ref('')

// --- Panier / nouvelle vente ---
const typeVente = ref('directe')
const codeVendeuse = ref('')
const vendeuseTrouvee = ref(null)
const codeRecherche = ref(false)
const codeErreur = ref('')
const produitSelectionne = ref('')
const quantiteSelectionnee = ref(1)
const lignesPanier = ref([])
const venteErreur = ref('')
const venteSoumission = ref(false)

const totalPanier = computed(() =>
  lignesPanier.value.reduce((s, l) => s + l.prix_vente * l.quantite, 0)
)

let timeoutRecherche = null
watch(codeVendeuse, (val) => {
  vendeuseTrouvee.value = null
  codeErreur.value = ''
  clearTimeout(timeoutRecherche)
  if (!/^\d{6}$/.test(val)) return
  timeoutRecherche = setTimeout(async () => {
    codeRecherche.value = true
    try {
      const { data } = await api.get(`/vendeuses/code/${val}`)
      if (!data.actif) {
        codeErreur.value = 'Cette vendeuse est desactivee'
      } else {
        vendeuseTrouvee.value = data
      }
    } catch {
      codeErreur.value = 'Aucune vendeuse ne correspond a ce code'
    } finally {
      codeRecherche.value = false
    }
  }, 300)
})

function ajouterLigne() {
  venteErreur.value = ''
  const produit = produits.value.find((p) => p.id === Number(produitSelectionne.value))
  if (!produit || quantiteSelectionnee.value <= 0) return

  const existante = lignesPanier.value.find((l) => l.produit_id === produit.id)
  if (existante) {
    existante.quantite += Number(quantiteSelectionnee.value)
  } else {
    lignesPanier.value.push({
      produit_id: produit.id,
      nom: produit.nom,
      prix_vente: Number(produit.prix_vente),
      quantite: Number(quantiteSelectionnee.value),
    })
  }
  produitSelectionne.value = ''
  quantiteSelectionnee.value = 1
}

function retirerLigne(index) {
  lignesPanier.value.splice(index, 1)
}

async function validerVente() {
  if (!lignesPanier.value.length) return
  venteErreur.value = ''
  venteSoumission.value = true
  try {
    const payload = {
      type: typeVente.value,
      vendeuse_code: typeVente.value === 'vendeuse' ? codeVendeuse.value : undefined,
      lignes: lignesPanier.value.map((l) => ({ produit_id: l.produit_id, quantite: l.quantite })),
    }
    await api.post('/ventes', payload)
    lignesPanier.value = []
    typeVente.value = 'directe'
    codeVendeuse.value = ''
    vendeuseTrouvee.value = null
    await chargerVentes()
    await chargerProduits()
  } catch (err) {
    venteErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement de la vente'
  } finally {
    venteSoumission.value = false
  }
}

// --- Liste des ventes ---
const filtres = reactive({ from: '', to: '', vendeuse_id: '' })
const detailVisible = ref(false)
const detailVente = ref(null)
const detailChargement = ref(false)

async function chargerVentes() {
  const params = {}
  if (filtres.from) params.from = filtres.from
  if (filtres.to) params.to = filtres.to
  if (filtres.vendeuse_id) params.vendeuse_id = filtres.vendeuse_id
  const { data } = await api.get('/ventes', { params })
  ventes.value = data
}

async function chargerProduits() {
  const { data } = await api.get('/produits')
  produits.value = data
}

async function ouvrirDetail(v) {
  detailVisible.value = true
  detailChargement.value = true
  try {
    const { data } = await api.get(`/ventes/${v.id}`)
    detailVente.value = data
  } finally {
    detailChargement.value = false
  }
}

onMounted(async () => {
  loading.value = true
  erreur.value = ''
  try {
    await Promise.all([
      chargerProduits(),
      chargerVentes(),
      api.get('/vendeuses').then((r) => { vendeuses.value = r.data }),
    ])
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
      <h1>Ventes</h1>
    </div>

    <p v-if="erreur" class="error-message">{{ erreur }}</p>

    <div class="card">
      <h2>Nouvelle vente</h2>

      <div class="form-row-inline">
        <div class="form-row">
          <label>Type de vente</label>
          <select v-model="typeVente">
            <option value="directe">Directe (boutique)</option>
            <option value="vendeuse">Attribuee a une vendeuse</option>
          </select>
        </div>
        <div class="form-row" v-if="typeVente === 'vendeuse'">
          <label>Code vendeuse (6 chiffres)</label>
          <input v-model="codeVendeuse" maxlength="6" inputmode="numeric" placeholder="123456" />
        </div>
      </div>

      <p v-if="typeVente === 'vendeuse' && codeRecherche" style="font-size: 13px">Recherche...</p>
      <p v-if="typeVente === 'vendeuse' && vendeuseTrouvee" class="badge success" style="width: fit-content">
        {{ vendeuseTrouvee.nom }}
      </p>
      <p v-if="typeVente === 'vendeuse' && codeErreur" class="error-message">{{ codeErreur }}</p>

      <div class="form-row-inline">
        <div class="form-row" style="flex: 2">
          <label>Produit</label>
          <select v-model="produitSelectionne">
            <option value="" disabled>Choisir un produit</option>
            <option v-for="p in produits" :key="p.id" :value="p.id">
              {{ p.nom }} — {{ formatMontant(p.prix_vente) }} ({{ p.quantite_stock }} {{ p.unite_stock }} en stock)
            </option>
          </select>
        </div>
        <div class="form-row">
          <label>Quantite</label>
          <input v-model="quantiteSelectionnee" type="number" min="1" step="1" />
        </div>
        <div class="form-row" style="justify-content: flex-end">
          <label>&nbsp;</label>
          <button type="button" @click="ajouterLigne" :disabled="!produitSelectionne">Ajouter</button>
        </div>
      </div>

      <table v-if="lignesPanier.length">
        <thead><tr><th>Produit</th><th>Quantite</th><th>Prix unitaire</th><th>Sous-total</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(l, i) in lignesPanier" :key="l.produit_id">
            <td>{{ l.nom }}</td>
            <td>{{ formatQuantite(l.quantite) }}</td>
            <td>{{ formatMontant(l.prix_vente) }}</td>
            <td>{{ formatMontant(l.prix_vente * l.quantite) }}</td>
            <td><button type="button" class="danger" @click="retirerLigne(i)">Retirer</button></td>
          </tr>
        </tbody>
      </table>

      <p v-if="lignesPanier.length" style="font-weight: 700; font-size: 18px; color: var(--text-h)">
        Total : {{ formatMontant(totalPanier) }}
      </p>

      <p v-if="venteErreur" class="error-message">{{ venteErreur }}</p>

      <button
        type="button"
        class="primary"
        :disabled="!lignesPanier.length || venteSoumission || (typeVente === 'vendeuse' && !vendeuseTrouvee)"
        @click="validerVente"
      >
        {{ venteSoumission ? 'Enregistrement...' : 'Valider la vente' }}
      </button>
    </div>

    <div class="card">
      <h2>Historique des ventes</h2>

      <div class="toolbar">
        <div class="form-row">
          <label>Du</label>
          <input v-model="filtres.from" type="date" />
        </div>
        <div class="form-row">
          <label>Au</label>
          <input v-model="filtres.to" type="date" />
        </div>
        <div class="form-row">
          <label>Vendeuse</label>
          <select v-model="filtres.vendeuse_id">
            <option value="">Toutes</option>
            <option v-for="v in vendeuses" :key="v.id" :value="v.id">{{ v.nom }}</option>
          </select>
        </div>
        <div class="form-row" style="justify-content: flex-end">
          <label>&nbsp;</label>
          <button type="button" @click="chargerVentes">Filtrer</button>
        </div>
      </div>

      <p v-if="loading">Chargement...</p>
      <table v-else>
        <thead><tr><th>Type</th><th>Montant</th><th>Date</th><th></th></tr></thead>
        <tbody>
          <tr v-for="v in ventes" :key="v.id">
            <td>{{ v.type === 'directe' ? 'Directe' : v.vendeuse_nom }}</td>
            <td>{{ formatMontant(v.montant_total) }}</td>
            <td>{{ formatDate(v.date) }}</td>
            <td><button type="button" @click="ouvrirDetail(v)">Details</button></td>
          </tr>
          <tr v-if="!ventes.length"><td colspan="4">Aucune vente</td></tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="detailVisible" title="Detail de la vente" @close="detailVisible = false">
      <p v-if="detailChargement">Chargement...</p>
      <template v-else-if="detailVente">
        <p><strong>Type :</strong> {{ detailVente.type === 'directe' ? 'Directe' : detailVente.vendeuse_nom }}</p>
        <p><strong>Date :</strong> {{ formatDate(detailVente.date) }}</p>
        <table>
          <thead><tr><th>Produit</th><th>Qte</th><th>Prix</th><th>Sous-total</th></tr></thead>
          <tbody>
            <tr v-for="l in detailVente.lignes" :key="l.id">
              <td>{{ l.produit_nom }}</td>
              <td>{{ formatQuantite(l.quantite) }}</td>
              <td>{{ formatMontant(l.prix_vente_snapshot) }}</td>
              <td>{{ formatMontant(l.prix_vente_snapshot * l.quantite) }}</td>
            </tr>
          </tbody>
        </table>
        <p style="font-weight: 700; margin-top: 8px">Total : {{ formatMontant(detailVente.montant_total) }}</p>
      </template>
    </Modal>
  </div>
</template>
