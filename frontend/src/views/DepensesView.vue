<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import api from '../api/client'
import { formatMontant, formatDate } from '../utils/format'

const depenses = ref([])
const loading = ref(true)
const erreur = ref('')

const form = reactive({ categorie: '', montant: '', note: '' })
const formErreur = ref('')
const soumission = ref(false)

const filtres = reactive({ from: '', to: '', categorie: '' })

const totalAffiche = computed(() => depenses.value.reduce((s, d) => s + Number(d.montant), 0))

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

onMounted(charger)

async function soumettre() {
  formErreur.value = ''
  soumission.value = true
  try {
    await api.post('/depenses', {
      categorie: form.categorie,
      montant: Number(form.montant),
      note: form.note || null,
    })
    Object.assign(form, { categorie: '', montant: '', note: '' })
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
    <div class="page-header">
      <h1>Depenses</h1>
    </div>

    <div class="card">
      <h2>Nouvelle depense</h2>
      <form @submit.prevent="soumettre">
        <div class="form-row-inline">
          <div class="form-row">
            <label>Categorie</label>
            <input v-model="form.categorie" placeholder="electricite, eau, transport..." required />
          </div>
          <div class="form-row">
            <label>Montant</label>
            <input v-model="form.montant" type="number" min="0" step="0.01" required />
          </div>
        </div>
        <div class="form-row">
          <label>Note (optionnel)</label>
          <input v-model="form.note" />
        </div>
        <p v-if="formErreur" class="error-message">{{ formErreur }}</p>
        <button type="submit" class="primary" :disabled="soumission">
          {{ soumission ? 'Enregistrement...' : 'Enregistrer' }}
        </button>
      </form>
    </div>

    <div class="card">
      <div class="page-header">
        <h2>Historique des depenses</h2>
        <div class="stat" style="text-align: right">
          <div class="label">Total affiche</div>
          <div class="value">{{ formatMontant(totalAffiche) }}</div>
        </div>
      </div>

      <div class="toolbar">
        <div class="form-row">
          <label>Categorie</label>
          <input v-model="filtres.categorie" placeholder="toutes" />
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
          <button type="button" @click="charger">Filtrer</button>
        </div>
      </div>

      <p v-if="erreur" class="error-message">{{ erreur }}</p>
      <p v-if="loading">Chargement...</p>
      <table v-else>
        <thead><tr><th>Categorie</th><th>Montant</th><th>Note</th><th>Date</th></tr></thead>
        <tbody>
          <tr v-for="d in depenses" :key="d.id">
            <td>{{ d.categorie }}</td>
            <td>{{ formatMontant(d.montant) }}</td>
            <td>{{ d.note || '-' }}</td>
            <td>{{ formatDate(d.date) }}</td>
          </tr>
          <tr v-if="!depenses.length"><td colspan="4">Aucune depense</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
