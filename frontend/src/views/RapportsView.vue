<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import api from '../api/client'
import { useModulesStore } from '../stores/modules'
import { formatMontant, formatQuantite } from '../utils/format'

const modules = useModulesStore()
const aucunSuiviFinancier = computed(() => !modules.ventes && !modules.depenses)

const loading = ref(false)
const erreur = ref('')
const rapport = ref(null)
const periodeActive = ref('journalier')

const plage = reactive({ from: '', to: '' })
const vendeuses = ref([])
const vendeuseFiltre = ref('')

function paramsVendeuse() {
  return modules.ventes && vendeuseFiltre.value ? { vendeuse_id: vendeuseFiltre.value } : {}
}

async function chargerPreset(periode) {
  periodeActive.value = periode
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get(`/rapports/${periode}`, { params: paramsVendeuse() })
    rapport.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

async function chargerPersonnalise() {
  if (!plage.from || !plage.to) return
  periodeActive.value = 'personnalise'
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get('/rapports', { params: { from: plage.from, to: plage.to, ...paramsVendeuse() } })
    rapport.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

function rechargerPeriodeCourante() {
  if (periodeActive.value === 'personnalise') {
    chargerPersonnalise()
  } else {
    chargerPreset(periodeActive.value)
  }
}

function imprimer() {
  window.print()
}

onMounted(async () => {
  if (aucunSuiviFinancier.value) return

  if (modules.ventes) {
    try {
      const { data } = await api.get('/vendeuses')
      vendeuses.value = data
    } catch {
      // non bloquant : le filtre par vendeuse reste vide si la liste echoue
    }
  }
  chargerPreset('journalier')
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Rapports</h1>
    </div>

    <p v-if="aucunSuiviFinancier" class="card" style="opacity: 0.75">
      Aucun module de suivi financier (Ventes, Depenses) n'est actif — il n'y a rien a rapporter ici.
      Activez Ventes et/ou Depenses dans Parametres pour generer des rapports.
    </p>

    <template v-else>
      <div class="card no-print">
        <div class="toolbar">
          <button type="button" :class="{ primary: periodeActive === 'journalier' }" @click="chargerPreset('journalier')">Journalier</button>
          <button type="button" :class="{ primary: periodeActive === 'hebdomadaire' }" @click="chargerPreset('hebdomadaire')">Hebdomadaire</button>
          <button type="button" :class="{ primary: periodeActive === 'mensuel' }" @click="chargerPreset('mensuel')">Mensuel</button>
          <button type="button" :class="{ primary: periodeActive === 'annuel' }" @click="chargerPreset('annuel')">Annuel</button>
        </div>
        <div class="toolbar">
          <div class="form-row">
            <label>Du</label>
            <input v-model="plage.from" type="date" />
          </div>
          <div class="form-row">
            <label>Au</label>
            <input v-model="plage.to" type="date" />
          </div>
          <div class="form-row" style="justify-content: flex-end">
            <label>&nbsp;</label>
            <button type="button" @click="chargerPersonnalise">Plage personnalisee</button>
          </div>
        </div>
        <div class="toolbar" v-if="modules.ventes">
          <div class="form-row">
            <label>Filtrer sur une vendeuse (optionnel)</label>
            <select v-model="vendeuseFiltre" @change="rechargerPeriodeCourante">
              <option value="">Toutes les vendeuses</option>
              <option v-for="v in vendeuses" :key="v.id" :value="v.id">{{ v.nom }} — {{ v.code }}</option>
            </select>
          </div>
        </div>
      </div>

      <p v-if="erreur" class="error-message">{{ erreur }}</p>
      <p v-if="loading">Chargement...</p>

      <template v-else-if="rapport">
        <!-- Previsualisation obligatoire a l'ecran avant tout export/impression -->
        <div class="card" id="apercu-rapport">
          <h2>
            Apercu du rapport
            <span v-if="vendeuseFiltre" style="font-weight: 400; font-size: 14px; opacity: 0.75">
              — {{ vendeuses.find((v) => v.id === Number(vendeuseFiltre))?.nom }}
            </span>
          </h2>

          <div class="card-grid" style="margin-bottom: 16px">
            <template v-if="modules.ventes">
              <div class="stat">
                <div class="label">CA direct</div>
                <div class="value">{{ formatMontant(rapport.chiffre_affaires.direct) }}</div>
              </div>
              <div class="stat">
                <div class="label">CA vendeuse(s)</div>
                <div class="value">{{ formatMontant(rapport.chiffre_affaires.vendeuses) }}</div>
              </div>
              <div class="stat">
                <div class="label">CA total</div>
                <div class="value">{{ formatMontant(rapport.chiffre_affaires.total) }}</div>
              </div>
              <div class="stat">
                <div class="label">Nombre de ventes</div>
                <div class="value">{{ rapport.nombre_ventes }}</div>
              </div>
              <div class="stat">
                <div class="label">Quantite vendue</div>
                <div class="value">{{ formatQuantite(rapport.quantite_vendue) }}</div>
              </div>
              <div class="stat">
                <div class="label">Cout des marchandises vendues</div>
                <div class="value">{{ formatMontant(rapport.cout_marchandises_vendues) }}</div>
              </div>
            </template>
            <div class="stat" v-if="modules.depenses">
              <div class="label">Depenses</div>
              <div class="value">{{ formatMontant(rapport.depenses_total) }}</div>
            </div>
            <div class="stat">
              <div class="label">Bilan net</div>
              <div class="value">{{ formatMontant(rapport.bilan_net) }}</div>
            </div>
          </div>

          <template v-if="modules.ventes">
            <h3>{{ vendeuseFiltre ? 'Performance de la vendeuse' : 'Detail par vendeuse (total de chacune, du meilleur au moins bon)' }}</h3>
            <table>
              <thead><tr><th>Vendeuse</th><th>Nombre de ventes</th><th>Montant</th><th>Taux de contribution</th></tr></thead>
              <tbody>
                <tr v-for="v in rapport.par_vendeuse" :key="v.vendeuse_id">
                  <td>{{ v.nom }}</td>
                  <td>{{ v.nombre_ventes }}</td>
                  <td>{{ formatMontant(v.montant) }}</td>
                  <td>{{ (v.taux_contribution * 100).toFixed(1) }}%</td>
                </tr>
                <tr v-if="!rapport.par_vendeuse.length"><td colspan="4">Aucune vente attribuee sur cette periode</td></tr>
              </tbody>
            </table>
          </template>
        </div>

        <div class="toolbar no-print">
          <button type="button" class="primary" @click="imprimer">Imprimer / Exporter</button>
        </div>
      </template>
    </template>
  </div>
</template>

<style>
@media print {
  .no-print, .sidebar { display: none !important; }
  .main-content { padding: 0 !important; }
}
</style>
