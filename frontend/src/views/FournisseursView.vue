<script setup>
import { ref, reactive, onMounted } from 'vue'
import api from '../api/client'
import Modal from '../components/Modal.vue'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'

const fournisseurs = ref([])
const loading = ref(true)
const erreur = ref('')
const includeInactifs = ref(false)

const formVisible = ref(false)
const modeEdition = ref(false)
const soumission = ref(false)
const formErreur = ref('')
const form = reactive({ id: null, nom: '', contact: '' })

const historiqueVisible = ref(false)
const historiqueChargement = ref(false)
const historiqueAchats = ref([])
const historiqueTotal = ref(null)
const historiqueNomFournisseur = ref('')

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get('/fournisseurs/totaux')
    fournisseurs.value = includeInactifs.value ? data : data.filter((f) => f.actif)
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
    const payload = { nom: form.nom, contact: form.contact || null }
    if (modeEdition.value) {
      await api.put(`/fournisseurs/${form.id}`, payload)
    } else {
      await api.post('/fournisseurs', payload)
    }
    formVisible.value = false
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement'
  } finally {
    soumission.value = false
  }
}

async function basculerActivation(f) {
  const action = f.actif ? 'desactiver' : 'activer'
  try {
    await api.patch(`/fournisseurs/${f.id}/${action}`)
    await charger()
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur'
  }
}

async function ouvrirHistorique(f) {
  historiqueVisible.value = true
  historiqueChargement.value = true
  historiqueNomFournisseur.value = f.nom
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
    <div class="page-header">
      <h1>Fournisseurs</h1>
      <button type="button" class="primary" @click="ouvrirCreation">+ Nouveau fournisseur</button>
    </div>

    <div class="toolbar">
      <label style="display: flex; align-items: center; gap: 6px; font-size: 14px">
        <input type="checkbox" v-model="includeInactifs" @change="charger" />
        Afficher les fournisseurs desactives
      </label>
    </div>

    <p v-if="erreur" class="error-message">{{ erreur }}</p>
    <p v-if="loading">Chargement...</p>

    <div class="card" v-else>
      <table>
        <thead>
          <tr><th>Nom</th><th>Contact</th><th>Achats</th><th>Quantite totale</th><th>Montant total</th><th>Statut</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="f in fournisseurs" :key="f.id">
            <td>{{ f.nom }}</td>
            <td>{{ f.contact || '-' }}</td>
            <td>{{ f.nombre_achats }}</td>
            <td>{{ formatQuantite(f.quantite_totale) }}</td>
            <td>{{ formatMontant(f.montant_total) }}</td>
            <td><span class="badge" :class="f.actif ? 'success' : 'danger'">{{ f.actif ? 'Actif' : 'Inactif' }}</span></td>
            <td style="display: flex; gap: 4px; flex-wrap: wrap">
              <button type="button" @click="ouvrirEdition(f)">Modifier</button>
              <button type="button" @click="ouvrirHistorique(f)">Historique</button>
              <button type="button" :class="f.actif ? 'danger' : ''" @click="basculerActivation(f)">
                {{ f.actif ? 'Desactiver' : 'Activer' }}
              </button>
            </td>
          </tr>
          <tr v-if="!fournisseurs.length"><td colspan="7">Aucun fournisseur</td></tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="formVisible" :title="modeEdition ? 'Modifier le fournisseur' : 'Nouveau fournisseur'" @close="formVisible = false">
      <form @submit.prevent="soumettreForm">
        <div class="form-row">
          <label>Nom</label>
          <input v-model="form.nom" required />
        </div>
        <div class="form-row">
          <label>Contact (optionnel)</label>
          <input v-model="form.contact" />
        </div>
        <p v-if="formErreur" class="error-message">{{ formErreur }}</p>
        <button type="submit" class="primary" :disabled="soumission">
          {{ soumission ? 'Enregistrement...' : 'Enregistrer' }}
        </button>
      </form>
    </Modal>

    <Modal v-if="historiqueVisible" :title="`Historique - ${historiqueNomFournisseur}`" @close="historiqueVisible = false">
      <p v-if="historiqueChargement">Chargement...</p>
      <template v-else>
        <div class="card-grid" style="margin-bottom: 12px">
          <div class="stat">
            <div class="label">Nombre d'achats</div>
            <div class="value">{{ historiqueTotal.nombre_achats }}</div>
          </div>
          <div class="stat">
            <div class="label">Montant total</div>
            <div class="value">{{ formatMontant(historiqueTotal.montant_total) }}</div>
          </div>
        </div>
        <table>
          <thead><tr><th>Produit</th><th>Quantite</th><th>Cout unitaire</th><th>Date</th></tr></thead>
          <tbody>
            <tr v-for="a in historiqueAchats" :key="a.id">
              <td>{{ a.produit_nom }}</td>
              <td>{{ formatQuantite(a.quantite) }}</td>
              <td>{{ formatMontant(a.cout_unitaire) }}</td>
              <td>{{ formatDate(a.date) }}</td>
            </tr>
            <tr v-if="!historiqueAchats.length"><td colspan="4">Aucun achat</td></tr>
          </tbody>
        </table>
      </template>
    </Modal>
  </div>
</template>
