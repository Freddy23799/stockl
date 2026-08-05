<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../api/client'
import { useModulesStore } from '../stores/modules'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'

const modules = useModulesStore()

const loading = ref(true)
const erreur = ref('')

const rapportJour = ref(null)
const alertes = ref([])
const activite = ref(null)
const comparaisonVeille = ref(null)

// Variation du CA du jour par rapport a hier (null si pas calculable, cf endpoint)
const variationCa = computed(() => comparaisonVeille.value?.variation_ca_pourcentage ?? null)

onMounted(async () => {
  try {
    const [rapportRes, alertesRes, activiteRes, comparaisonRes] = await Promise.all([
      api.get('/rapports/journalier'),
      api.get('/stock/alertes'),
      api.get('/rapports/activite-recente?limite=8'),
      modules.ventes ? api.get('/rapports/comparaison-veille') : Promise.resolve({ data: null }),
    ])
    rapportJour.value = rapportRes.data
    alertes.value = alertesRes.data
    activite.value = activiteRes.data
    comparaisonVeille.value = comparaisonRes.data
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
      <h1>Tableau de bord</h1>
    </div>

    <p v-if="erreur" class="error-message">{{ erreur }}</p>
    <p v-if="loading">Chargement...</p>

    <template v-else>
      <div class="card-grid" style="margin-bottom: 16px">
        <div class="card stat" v-if="modules.ventes">
          <div class="label">Chiffre d'affaires (aujourd'hui)</div>
          <div class="value">
            {{ formatMontant(rapportJour.chiffre_affaires.total) }}
            <span v-if="variationCa !== null" class="badge" :class="variationCa >= 0 ? 'success' : 'danger'" style="vertical-align: middle; margin-left: 4px">
              {{ variationCa >= 0 ? '▲' : '▼' }} {{ Math.abs(variationCa).toFixed(1) }}%
            </span>
          </div>
        </div>
        <div class="card stat" v-if="modules.ventes">
          <div class="label">Ventes (aujourd'hui)</div>
          <div class="value">{{ rapportJour.nombre_ventes }}</div>
        </div>
        <div class="card stat" v-if="modules.ventes || modules.depenses">
          <div class="label">Bilan net (aujourd'hui)</div>
          <div class="value">{{ formatMontant(rapportJour.bilan_net) }}</div>
        </div>
        <div class="card stat">
          <div class="label">Produits en alerte</div>
          <div class="value">{{ alertes.length }}</div>
        </div>
      </div>

      <p v-if="!modules.ventes && !modules.depenses" class="card" style="opacity: 0.75">
        Aucun module de suivi financier (Ventes, Depenses) n'est actif. Le tableau de bord se limite
        au suivi du stock. Activez-les dans Parametres pour voir chiffre d'affaires et bilan.
      </p>

      <div class="card" v-if="alertes.length">
        <h2>Alertes de stock</h2>
        <table>
          <thead>
            <tr><th>Produit</th><th>Stock</th><th>Seuil</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in alertes" :key="p.id">
              <td>{{ p.nom }}</td>
              <td>{{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }}</td>
              <td>{{ formatQuantite(p.seuil_alerte) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card-grid">
        <div class="card" v-if="modules.ventes">
          <h2>Dernieres ventes</h2>
          <table>
            <thead><tr><th>Type</th><th>Montant</th><th>Date</th></tr></thead>
            <tbody>
              <tr v-for="v in activite.dernieres_ventes" :key="v.id">
                <td>{{ v.type === 'directe' ? 'Directe' : v.vendeuse_nom }}</td>
                <td>{{ formatMontant(v.montant_total) }}</td>
                <td>{{ formatDate(v.date) }}</td>
              </tr>
              <tr v-if="!activite.dernieres_ventes.length"><td colspan="3">Aucune vente</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>Derniers mouvements de stock</h2>
          <table>
            <thead><tr><th>Produit</th><th>Type</th><th>Qte</th></tr></thead>
            <tbody>
              <tr v-for="m in activite.derniers_mouvements_stock" :key="m.id">
                <td>{{ m.produit_nom }}</td>
                <td>
                  <span class="badge" :class="m.type === 'entree' ? 'success' : 'warning'">{{ m.type }}</span>
                </td>
                <td>{{ formatQuantite(m.quantite) }}</td>
              </tr>
              <tr v-if="!activite.derniers_mouvements_stock.length"><td colspan="3">Aucun mouvement</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card" v-if="modules.depenses">
          <h2>Dernieres depenses</h2>
          <table>
            <thead><tr><th>Categorie</th><th>Montant</th><th>Date</th></tr></thead>
            <tbody>
              <tr v-for="d in activite.dernieres_depenses" :key="d.id">
                <td>{{ d.categorie }}</td>
                <td>{{ formatMontant(d.montant) }}</td>
                <td>{{ formatDate(d.date) }}</td>
              </tr>
              <tr v-if="!activite.dernieres_depenses.length"><td colspan="3">Aucune depense</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
