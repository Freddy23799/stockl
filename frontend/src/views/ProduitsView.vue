<script setup>
import { ref, onMounted, reactive } from 'vue'
import api, { assetUrl } from '../api/client'
import Modal from '../components/Modal.vue'
import { formatMontant, formatDate } from '../utils/format'

const produits = ref([])
const loading = ref(true)
const erreur = ref('')
const includeInactifs = ref(false)

const formVisible = ref(false)
const modeEdition = ref(false)
const soumission = ref(false)
const formErreur = ref('')
const form = reactive({
  id: null, nom: '', prix_vente: '', unite_stock: '', unite_achat: '', facteur_conversion: 1, seuil_alerte: 0,
})

const historiqueVisible = ref(false)
const historiquePrix = ref([])
const historiqueChargement = ref(false)

const photoVisible = ref(false)
const photoProduitId = ref(null)
const photoFichier = ref(null)
const photoEnvoi = ref(false)
const photoErreur = ref('')

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get('/produits', { params: { includeInactifs: includeInactifs.value } })
    produits.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

onMounted(charger)

function ouvrirCreation() {
  modeEdition.value = false
  formErreur.value = ''
  Object.assign(form, { id: null, nom: '', prix_vente: '', unite_stock: '', unite_achat: '', facteur_conversion: 1, seuil_alerte: 0 })
  formVisible.value = true
}

function ouvrirEdition(p) {
  modeEdition.value = true
  formErreur.value = ''
  Object.assign(form, {
    id: p.id, nom: p.nom, prix_vente: p.prix_vente, unite_stock: p.unite_stock,
    unite_achat: p.unite_achat || '', facteur_conversion: p.facteur_conversion, seuil_alerte: p.seuil_alerte,
  })
  formVisible.value = true
}

async function soumettreForm() {
  soumission.value = true
  formErreur.value = ''
  try {
    const payload = {
      nom: form.nom,
      prix_vente: Number(form.prix_vente),
      unite_stock: form.unite_stock,
      unite_achat: form.unite_achat || null,
      facteur_conversion: Number(form.facteur_conversion) || 1,
      seuil_alerte: Number(form.seuil_alerte) || 0,
    }
    if (modeEdition.value) {
      await api.put(`/produits/${form.id}`, payload)
    } else {
      await api.post('/produits', payload)
    }
    formVisible.value = false
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement'
  } finally {
    soumission.value = false
  }
}

async function desactiver(p) {
  if (!confirm(`Desactiver le produit "${p.nom}" ? Son historique reste conserve.`)) return
  try {
    await api.patch(`/produits/${p.id}/desactiver`)
    await charger()
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur lors de la desactivation'
  }
}

async function ouvrirHistorique(p) {
  historiqueVisible.value = true
  historiqueChargement.value = true
  photoProduitId.value = p.id
  try {
    const { data } = await api.get(`/produits/${p.id}/historique-prix`)
    historiquePrix.value = data
  } finally {
    historiqueChargement.value = false
  }
}

function ouvrirPhoto(p) {
  photoProduitId.value = p.id
  photoFichier.value = null
  photoErreur.value = ''
  photoVisible.value = true
}

function surChoixFichier(e) {
  photoFichier.value = e.target.files[0] || null
}

async function envoyerPhoto() {
  if (!photoFichier.value) return
  photoEnvoi.value = true
  photoErreur.value = ''
  try {
    const formData = new FormData()
    formData.append('photo', photoFichier.value)
    await api.post(`/produits/${photoProduitId.value}/photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    photoVisible.value = false
    await charger()
  } catch (err) {
    photoErreur.value = err.response?.data?.message || 'Erreur lors de l\'envoi de la photo'
  } finally {
    photoEnvoi.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Produits (catalogue)</h1>
      <button type="button" class="primary" @click="ouvrirCreation">+ Nouveau produit</button>
    </div>

    <div class="toolbar">
      <label style="display: flex; align-items: center; gap: 6px; font-size: 14px">
        <input type="checkbox" v-model="includeInactifs" @change="charger" />
        Afficher les produits desactives
      </label>
    </div>

    <p v-if="erreur" class="error-message">{{ erreur }}</p>
    <p v-if="loading">Chargement...</p>

    <div class="card" v-else>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Nom</th>
            <th>Prix de vente</th>
            <th>Unite stock</th>
            <th>Unite achat</th>
            <th>Facteur</th>
            <th>Stock</th>
            <th>Seuil</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in produits" :key="p.id">
            <td>
              <img v-if="p.photo" :src="assetUrl(p.photo)" class="thumb" alt="" />
              <div v-else class="thumb" />
            </td>
            <td>{{ p.nom }}</td>
            <td>{{ formatMontant(p.prix_vente) }}</td>
            <td>{{ p.unite_stock }}</td>
            <td>{{ p.unite_achat || '-' }}</td>
            <td>{{ p.facteur_conversion }}</td>
            <td>{{ p.quantite_stock }}</td>
            <td>{{ p.seuil_alerte }}</td>
            <td>
              <span class="badge" :class="p.actif ? 'success' : 'danger'">{{ p.actif ? 'Actif' : 'Inactif' }}</span>
            </td>
            <td style="display: flex; gap: 4px; flex-wrap: wrap">
              <button type="button" @click="ouvrirEdition(p)">Modifier</button>
              <button type="button" @click="ouvrirPhoto(p)">Photo</button>
              <button type="button" @click="ouvrirHistorique(p)">Historique prix</button>
              <button type="button" class="danger" v-if="p.actif" @click="desactiver(p)">Desactiver</button>
            </td>
          </tr>
          <tr v-if="!produits.length"><td colspan="10">Aucun produit</td></tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="formVisible" :title="modeEdition ? 'Modifier le produit' : 'Nouveau produit'" @close="formVisible = false">
      <form @submit.prevent="soumettreForm">
        <div class="form-row">
          <label>Nom</label>
          <input v-model="form.nom" required />
        </div>
        <div class="form-row">
          <label>Prix de vente</label>
          <input v-model="form.prix_vente" type="number" min="0" step="0.01" required />
        </div>
        <div class="form-row-inline">
          <div class="form-row">
            <label>Unite de stock (reference)</label>
            <input v-model="form.unite_stock" placeholder="piece, mL, g..." required />
          </div>
          <div class="form-row">
            <label>Unite d'achat (optionnel)</label>
            <input v-model="form.unite_achat" placeholder="carton, bidon, kg..." />
          </div>
        </div>
        <div class="form-row-inline">
          <div class="form-row">
            <label>Facteur de conversion</label>
            <input v-model="form.facteur_conversion" type="number" min="0.0001" step="0.0001" />
          </div>
          <div class="form-row">
            <label>Seuil d'alerte</label>
            <input v-model="form.seuil_alerte" type="number" min="0" step="0.01" />
          </div>
        </div>
        <p v-if="formErreur" class="error-message">{{ formErreur }}</p>
        <button type="submit" class="primary" :disabled="soumission">
          {{ soumission ? 'Enregistrement...' : 'Enregistrer' }}
        </button>
      </form>
    </Modal>

    <Modal v-if="historiqueVisible" title="Historique des prix" @close="historiqueVisible = false">
      <p v-if="historiqueChargement">Chargement...</p>
      <table v-else>
        <thead><tr><th>Date</th><th>Ancien prix</th><th>Nouveau prix</th></tr></thead>
        <tbody>
          <tr v-for="h in historiquePrix" :key="h.id">
            <td>{{ formatDate(h.date) }}</td>
            <td>{{ formatMontant(h.ancien_prix) }}</td>
            <td>{{ formatMontant(h.nouveau_prix) }}</td>
          </tr>
          <tr v-if="!historiquePrix.length"><td colspan="3">Aucun changement de prix</td></tr>
        </tbody>
      </table>
    </Modal>

    <Modal v-if="photoVisible" title="Photo du produit" @close="photoVisible = false">
      <form @submit.prevent="envoyerPhoto">
        <div class="form-row">
          <input type="file" accept="image/png,image/jpeg,image/webp" @change="surChoixFichier" />
        </div>
        <p v-if="photoErreur" class="error-message">{{ photoErreur }}</p>
        <button type="submit" class="primary" :disabled="!photoFichier || photoEnvoi">
          {{ photoEnvoi ? 'Envoi...' : 'Envoyer' }}
        </button>
      </form>
    </Modal>
  </div>
</template>
