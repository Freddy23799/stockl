<script setup>
import { ref, onMounted, reactive } from 'vue'
import api from '../api/client'
import Modal from '../components/Modal.vue'

const vendeuses = ref([])
const loading = ref(true)
const erreur = ref('')
const includeInactifs = ref(false)

const formVisible = ref(false)
const modeEdition = ref(false)
const soumission = ref(false)
const formErreur = ref('')
const form = reactive({ id: null, nom: '', contact: '' })
const dernierCodeCree = ref(null)

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get('/vendeuses', { params: { includeInactifs: includeInactifs.value } })
    vendeuses.value = data
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
    } else {
      const { data } = await api.post('/vendeuses', payload)
      dernierCodeCree.value = data.code
    }
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement'
  } finally {
    soumission.value = false
  }
}

async function basculerActivation(v) {
  const action = v.actif ? 'desactiver' : 'activer'
  try {
    await api.patch(`/vendeuses/${v.id}/${action}`)
    await charger()
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur'
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Vendeuses</h1>
      <button type="button" class="primary" @click="ouvrirCreation">+ Nouvelle vendeuse</button>
    </div>

    <p style="font-size: 13px; opacity: 0.75; margin-bottom: 12px">
      Les vendeuses ne sont pas des comptes de connexion : chacune recoit un code a 6 chiffres,
      genere automatiquement et permanent, qui l'identifie au moment d'enregistrer une vente.
    </p>

    <div class="toolbar">
      <label style="display: flex; align-items: center; gap: 6px; font-size: 14px">
        <input type="checkbox" v-model="includeInactifs" @change="charger" />
        Afficher les vendeuses desactivees
      </label>
    </div>

    <p v-if="erreur" class="error-message">{{ erreur }}</p>
    <p v-if="loading">Chargement...</p>

    <div class="card" v-else>
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Nom</th><th>Contact</th><th>Statut</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vendeuses" :key="v.id">
            <td><code>{{ v.code }}</code></td>
            <td>{{ v.nom }}</td>
            <td>{{ v.contact || '-' }}</td>
            <td>
              <span class="badge" :class="v.actif ? 'success' : 'danger'">{{ v.actif ? 'Active' : 'Inactive' }}</span>
            </td>
            <td style="display: flex; gap: 4px; flex-wrap: wrap">
              <button type="button" @click="ouvrirEdition(v)">Modifier</button>
              <button type="button" :class="v.actif ? 'danger' : ''" @click="basculerActivation(v)">
                {{ v.actif ? 'Desactiver' : 'Activer' }}
              </button>
            </td>
          </tr>
          <tr v-if="!vendeuses.length"><td colspan="5">Aucune vendeuse</td></tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="formVisible" :title="modeEdition ? 'Modifier la vendeuse' : 'Nouvelle vendeuse'" @close="formVisible = false">
      <template v-if="dernierCodeCree">
        <p>Vendeuse creee. Son code d'identification :</p>
        <p style="font-size: 32px; font-weight: 700; text-align: center; letter-spacing: 4px; color: var(--text-h)">
          {{ dernierCodeCree }}
        </p>
        <p style="font-size: 13px; opacity: 0.75">
          Ce code est permanent - communiquez-le a la vendeuse, elle l'utilisera pour enregistrer ses ventes.
        </p>
        <button type="button" class="primary" @click="formVisible = false">Fermer</button>
      </template>
      <form v-else @submit.prevent="soumettreForm">
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
  </div>
</template>
