<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import api, { assetUrl } from '../api/client'
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

// Serie quotidienne pour le graphique de tendance (endpoint /rapports/serie)
const serie = ref([])

// Performance produits (endpoint /rapports/performance-produits)
const performanceProduits = ref(null)

function paramsVendeuse() {
  return modules.ventes && vendeuseFiltre.value ? { vendeuse_id: vendeuseFiltre.value } : {}
}

async function chargerSerie(from, to) {
  if (!modules.ventes) {
    serie.value = []
    return
  }
  try {
    const { data } = await api.get('/rapports/serie', { params: { from, to, ...paramsVendeuse() } })
    serie.value = data.serie || []
  } catch {
    serie.value = []
  }
}

async function chargerPerformanceProduits(from, to) {
  if (!modules.ventes) {
    performanceProduits.value = null
    return
  }
  try {
    const { data } = await api.get('/rapports/performance-produits', { params: { from, to, limite: 5 } })
    performanceProduits.value = data
  } catch {
    performanceProduits.value = null
  }
}

async function chargerDonneesComplementaires() {
  if (!rapport.value) return
  const { from, to } = rapport.value.periode
  await Promise.all([chargerSerie(from, to), chargerPerformanceProduits(from, to)])
}

async function chargerPreset(periode) {
  periodeActive.value = periode
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get(`/rapports/${periode}`, { params: paramsVendeuse() })
    rapport.value = data
    await chargerDonneesComplementaires()
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
    await chargerDonneesComplementaires()
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

// --- Graphique de tendance (SVG inline, sans dependance externe) ---
const GRAPH_W = 600
const GRAPH_H = 170
const GRAPH_PAD_TOP = 16
const GRAPH_PAD_BOTTOM = 20
const GRAPH_BASELINE = GRAPH_H - GRAPH_PAD_BOTTOM

function formatJourCourt(jour) {
  const [, m, d] = String(jour).split('-')
  return `${d}/${m}`
}

const graphMax = computed(() => {
  const valeurs = serie.value.map((j) => Number(j.chiffre_affaires) || 0)
  return Math.max(1, ...valeurs)
})

const graphBarres = computed(() => {
  const pts = serie.value
  const n = pts.length
  if (!n) return []
  const gap = 2
  const largeur = Math.min(28, (GRAPH_W - gap * (n - 1)) / n)
  const largeurTotale = largeur * n + gap * (n - 1)
  const decalageX = (GRAPH_W - largeurTotale) / 2
  const hauteurDispo = GRAPH_BASELINE - GRAPH_PAD_TOP
  const espacementLabel = n <= 10 ? 1 : Math.ceil(n / 8)
  return pts.map((p, i) => {
    const valeur = Number(p.chiffre_affaires) || 0
    const hauteur = graphMax.value > 0 ? (valeur / graphMax.value) * hauteurDispo : 0
    const x = decalageX + i * (largeur + gap)
    const y = GRAPH_BASELINE - hauteur
    return {
      jour: p.jour,
      valeur,
      x,
      y,
      largeur,
      hauteur,
      afficherLabel: i % espacementLabel === 0 || i === n - 1,
    }
  })
})

function graphBarPath(b) {
  const r = Math.min(4, b.largeur / 2, b.hauteur)
  if (b.hauteur <= 0) {
    return `M${b.x},${GRAPH_BASELINE} h${b.largeur} v0 h-${b.largeur} Z`
  }
  return `M${b.x},${b.y + b.hauteur} L${b.x},${b.y + r} Q${b.x},${b.y} ${b.x + r},${b.y} L${b.x + b.largeur - r},${b.y} Q${b.x + b.largeur},${b.y} ${b.x + b.largeur},${b.y + r} L${b.x + b.largeur},${b.y + b.hauteur} Z`
}

// --- Badges de tendance (partages entre le tableau des ventes fortes/faibles) ---
function classeTendance(tendance) {
  if (tendance === 'hausse') return 'success'
  if (tendance === 'baisse') return 'danger'
  return ''
}

function texteTendance(p) {
  const fleche = p.tendance === 'hausse' ? '▲' : p.tendance === 'baisse' ? '▼' : '-'
  if (p.variation_pourcentage === null || p.variation_pourcentage === undefined) return fleche
  return `${fleche} ${Math.abs(p.variation_pourcentage).toFixed(1)}%`
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

          <div class="rapport-graphique" v-if="modules.ventes">
            <h3>Evolution du chiffre d'affaires</h3>
            <p v-if="!serie.length" style="opacity: 0.75; font-size: 14px">Aucune donnee sur cette periode</p>
            <svg
              v-else
              :viewBox="`0 0 ${GRAPH_W} ${GRAPH_H}`"
              preserveAspectRatio="xMidYMid meet"
              class="rapport-graphique-svg"
              role="img"
              aria-label="Chiffre d'affaires par jour sur la periode selectionnee"
            >
              <line x1="0" :y1="GRAPH_BASELINE" :x2="GRAPH_W" :y2="GRAPH_BASELINE" class="rapport-graphique-axe" />
              <text x="2" y="12" class="rapport-graphique-max">{{ formatMontant(graphMax) }}</text>
              <g v-for="b in graphBarres" :key="b.jour">
                <path :d="graphBarPath(b)" class="rapport-graphique-barre">
                  <title>{{ formatJourCourt(b.jour) }} : {{ formatMontant(b.valeur) }}</title>
                </path>
                <text v-if="b.afficherLabel" :x="b.x + b.largeur / 2" :y="GRAPH_H - 4" text-anchor="middle" class="rapport-graphique-label">
                  {{ formatJourCourt(b.jour) }}
                </text>
              </g>
            </svg>
          </div>

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

        <div class="card" v-if="modules.ventes && performanceProduits && performanceProduits.actif">
          <h2>Performance des produits</h2>
          <div style="display: flex; gap: 16px; flex-wrap: wrap">
            <div style="flex: 1; min-width: 280px">
              <h3>Meilleures ventes</h3>
              <table>
                <thead>
                  <tr><th></th><th>Produit</th><th>Quantite</th><th>Montant</th><th>Tendance</th></tr>
                </thead>
                <tbody>
                  <tr v-for="p in performanceProduits.meilleures_ventes" :key="p.id">
                    <td>
                      <img v-if="p.photo" :src="assetUrl(p.photo)" class="thumb" alt="" />
                      <div v-else class="thumb" />
                    </td>
                    <td>{{ p.nom }}</td>
                    <td>{{ formatQuantite(p.quantite_vendue) }}</td>
                    <td>{{ formatMontant(p.montant) }}</td>
                    <td><span class="badge" :class="classeTendance(p.tendance)">{{ texteTendance(p) }}</span></td>
                  </tr>
                  <tr v-if="!performanceProduits.meilleures_ventes.length"><td colspan="5">Aucune donnee sur cette periode</td></tr>
                </tbody>
              </table>
            </div>
            <div style="flex: 1; min-width: 280px">
              <h3>Ventes faibles</h3>
              <table>
                <thead>
                  <tr><th></th><th>Produit</th><th>Quantite</th><th>Montant</th><th>Tendance</th></tr>
                </thead>
                <tbody>
                  <tr v-for="p in performanceProduits.faibles_ventes" :key="p.id">
                    <td>
                      <img v-if="p.photo" :src="assetUrl(p.photo)" class="thumb" alt="" />
                      <div v-else class="thumb" />
                    </td>
                    <td>{{ p.nom }}</td>
                    <td>{{ formatQuantite(p.quantite_vendue) }}</td>
                    <td>{{ formatMontant(p.montant) }}</td>
                    <td><span class="badge" :class="classeTendance(p.tendance)">{{ texteTendance(p) }}</span></td>
                  </tr>
                  <tr v-if="!performanceProduits.faibles_ventes.length"><td colspan="5">Aucune donnee sur cette periode</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="toolbar no-print">
          <button type="button" class="primary" @click="imprimer">Imprimer / Exporter</button>
        </div>
      </template>
    </template>
  </div>
</template>

<style>
.rapport-graphique { margin-bottom: 20px; }
.rapport-graphique-svg { width: 100%; height: 170px; display: block; }
.rapport-graphique-barre { fill: var(--accent); cursor: pointer; }
.rapport-graphique-barre:hover { opacity: 0.75; }
.rapport-graphique-axe { stroke: var(--border); stroke-width: 1; }
.rapport-graphique-label { font-size: 9px; fill: var(--text); opacity: 0.7; }
.rapport-graphique-max { font-size: 10px; fill: var(--text); opacity: 0.6; }

@media print {
  .no-print, .sidebar { display: none !important; }
  .main-content { padding: 0 !important; }
}
</style>
