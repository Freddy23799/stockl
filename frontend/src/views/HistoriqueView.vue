<script setup>
import { ref, reactive, onMounted } from 'vue'
import api from '../api/client'
import { formatDate } from '../utils/format'

const operations = ref([])
const utilisateurs = ref([])
const loading = ref(true)
const erreur = ref('')

const filtres = reactive({ type_operation: '', utilisateur_id: '', from: '', to: '' })

const typesConnus = [
  'produit_creation', 'produit_modification', 'produit_changement_prix', 'produit_desactivation',
  'vendeuse_creation', 'vendeuse_activation', 'vendeuse_desactivation',
  'utilisateur_creation', 'utilisateur_desactivation',
  'vente_creation', 'entree_stock',
  'depense_creation',
  'fournisseur_creation', 'fournisseur_activation', 'fournisseur_desactivation',
  'parametres_modification', 'parametres_logo_modifie',
]

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const params = {}
    if (filtres.type_operation) params.type_operation = filtres.type_operation
    if (filtres.utilisateur_id) params.utilisateur_id = filtres.utilisateur_id
    if (filtres.from) params.from = filtres.from
    if (filtres.to) params.to = filtres.to
    const { data } = await api.get('/historique', { params })
    operations.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/utilisateurs')
    utilisateurs.value = data
  } catch {
    // non bloquant : le filtre par utilisateur reste vide si la liste echoue
  }
  await charger()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Historique / audit</h1>
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="form-row">
          <label>Type d'operation</label>
          <select v-model="filtres.type_operation">
            <option value="">Tous</option>
            <option v-for="t in typesConnus" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>Utilisateur</label>
          <select v-model="filtres.utilisateur_id">
            <option value="">Tous</option>
            <option v-for="u in utilisateurs" :key="u.id" :value="u.id">{{ u.nom }}</option>
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
          <button type="button" @click="charger">Filtrer</button>
        </div>
      </div>

      <p v-if="erreur" class="error-message">{{ erreur }}</p>
      <p v-if="loading">Chargement...</p>
      <table v-else>
        <thead><tr><th>Date</th><th>Operation</th><th>Utilisateur</th><th>Details</th></tr></thead>
        <tbody>
          <tr v-for="op in operations" :key="op.id">
            <td>{{ formatDate(op.date) }}</td>
            <td><span class="badge success">{{ op.type_operation }}</span></td>
            <td>{{ op.utilisateur_nom || '-' }}</td>
            <td><code style="font-size: 12px">{{ JSON.stringify(op.details) }}</code></td>
          </tr>
          <tr v-if="!operations.length"><td colspan="4">Aucune operation</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
