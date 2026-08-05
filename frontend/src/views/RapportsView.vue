<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import api, { assetUrl } from '../api/client'
import { useModulesStore } from '../stores/modules'
import { formatMontant, formatQuantite, formatDateCourt } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import BoutonExport from '../components/ui/BoutonExport.vue'
import Tabs from '../components/ui/Tabs.vue'
import StatCard from '../components/ui/StatCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import Icon from '../components/ui/Icon.vue'

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

const ongletActif = ref('synthese')

const onglets = computed(() => {
  const liste = [
    { id: 'synthese', label: 'Synthese', icon: 'chart' },
    { id: 'produits', label: 'Produits', icon: 'package' },
  ]
  if (modules.ventes) liste.push({ id: 'vendeuses', label: 'Vendeuses', icon: 'users' })
  return liste
})

// Le module Ventes peut etre coupe pendant la consultation : on ne laisse pas
// l'onglet vendeuses actif sur un contenu qui n'existe plus.
watch(
  () => modules.ventes,
  (actif) => {
    if (!actif && ongletActif.value === 'vendeuses') ongletActif.value = 'synthese'
  }
)

const vendeuseCourante = computed(() =>
  vendeuses.value.find((v) => v.id === Number(vendeuseFiltre.value))
)

// Le serveur renvoie des horodatages ISO complets. Les afficher tels quels
// ("2026-08-04T23:00:00.000Z") n'apprend rien a personne : on n'affiche que le
// jour, et une seule date quand la periode tient sur une journee.
const libellePeriode = computed(() => {
  if (!rapport.value?.periode) return ''
  const { from, to } = rapport.value.periode
  if (!from && !to) return ''
  const debut = formatDateCourt(from)
  const fin = formatDateCourt(to)
  return debut === fin ? debut : `${debut} au ${fin}`
})

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
const GRAPH_W = 640
const GRAPH_H = 210
const GRAPH_PAD_TOP = 14
const GRAPH_PAD_BOTTOM = 26
const GRAPH_PAD_LEFT = 56
const GRAPH_PAD_RIGHT = 10
const GRAPH_BASELINE = GRAPH_H - GRAPH_PAD_BOTTOM
const GRAPH_ZONE_W = GRAPH_W - GRAPH_PAD_LEFT - GRAPH_PAD_RIGHT

function formatJourCourt(jour) {
  const [, m, d] = String(jour).split('-')
  return `${d}/${m}`
}

// Montants abreges pour l'axe : "1,2 M" tient dans la gouttiere, pas "1 200 000 F".
function formatMontantCourt(valeur) {
  const n = Number(valeur) || 0
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
  if (n >= 1000) return `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

// Un maximum "rond" donne des graduations lisibles (50 k plutot que 47 312).
const graphMax = computed(() => {
  const brut = Math.max(0, ...serie.value.map((j) => Number(j.chiffre_affaires) || 0))
  if (brut <= 0) return 1
  const puissance = 10 ** Math.floor(Math.log10(brut))
  const pas = [1, 2, 2.5, 5, 10].find((p) => brut <= p * puissance) || 10
  return pas * puissance
})

const graphGraduations = computed(() =>
  [1, 0.5, 0].map((ratio) => ({
    ratio,
    valeur: graphMax.value * ratio,
    y: GRAPH_BASELINE - ratio * (GRAPH_BASELINE - GRAPH_PAD_TOP),
  }))
)

const graphBarres = computed(() => {
  const pts = serie.value
  const n = pts.length
  if (!n) return []
  const gap = 2
  const largeur = Math.min(28, (GRAPH_ZONE_W - gap * (n - 1)) / n)
  const largeurTotale = largeur * n + gap * (n - 1)
  const decalageX = GRAPH_PAD_LEFT + (GRAPH_ZONE_W - largeurTotale) / 2
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
    <PageHeader
      title="Rapports"
      subtitle="Chiffre d'affaires, produits et vendeuses sur la periode choisie. La periode s'applique aux trois onglets."
    >
      <template #actions>
        <BoutonExport
          class="no-print"
          chemin="/exports/synthese.pdf"
          :params="{ from: plage.from, to: plage.to, vendeuse_id: vendeuseFiltre }"
          libelle="Rapport de synthese"
          fichier="rapport-de-synthese"
          variante="primary"
        />
        <button type="button" class="no-print" :disabled="!rapport" @click="imprimer">
          <Icon name="printer" :size="15" /> Imprimer
        </button>
      </template>
    </PageHeader>

    <div v-if="aucunSuiviFinancier" class="card">
      <EmptyState
        icon="chart"
        title="Aucun suivi financier actif"
        desc="Les modules Ventes et Depenses sont tous les deux desactives : il n'y a rien a rapporter. Activez-en au moins un dans Parametres."
      />
    </div>

    <template v-else>
      <!-- Barre de periode : elle pilote les trois onglets, elle reste donc au-dessus -->
      <div class="card no-print mb-4">
        <div class="card-body">
          <div class="toolbar">
            <div class="field">
              <label>Periode</label>
              <div class="btn-group">
                <button type="button" :class="{ 'is-active': periodeActive === 'journalier' }" @click="chargerPreset('journalier')">Journalier</button>
                <button type="button" :class="{ 'is-active': periodeActive === 'hebdomadaire' }" @click="chargerPreset('hebdomadaire')">Hebdomadaire</button>
                <button type="button" :class="{ 'is-active': periodeActive === 'mensuel' }" @click="chargerPreset('mensuel')">Mensuel</button>
                <button type="button" :class="{ 'is-active': periodeActive === 'annuel' }" @click="chargerPreset('annuel')">Annuel</button>
              </div>
            </div>

            <div class="field">
              <label>Du</label>
              <input v-model="plage.from" type="date" />
            </div>
            <div class="field">
              <label>Au</label>
              <input v-model="plage.to" type="date" />
            </div>
            <div class="field">
              <label>&nbsp;</label>
              <button
                type="button"
                :class="{ 'is-active': periodeActive === 'personnalise' }"
                :disabled="!plage.from || !plage.to"
                @click="chargerPersonnalise"
              >
                <Icon name="calendar" :size="15" /> Appliquer
              </button>
            </div>

            <div v-if="modules.ventes" class="field" style="min-width: 220px">
              <label>Vendeuse</label>
              <select v-model="vendeuseFiltre" @change="rechargerPeriodeCourante">
                <option value="">Toutes les vendeuses</option>
                <option v-for="v in vendeuses" :key="v.id" :value="v.id">{{ v.nom }} — {{ v.code }}</option>
              </select>
            </div>
          </div>

          <p v-if="libellePeriode" class="small muted mt-3">
            Periode affichee : <span class="strong">{{ libellePeriode }}</span>
            <template v-if="vendeuseCourante"> — filtre sur {{ vendeuseCourante.nom }}</template>
          </p>
        </div>
      </div>

      <p v-if="erreur" class="alert alert-danger mb-4">
        <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
      </p>

      <Tabs v-model="ongletActif" :tabs="onglets" />

      <div v-if="loading" class="stack">
        <div class="grid grid-stats">
          <div v-for="i in 4" :key="i" class="stat">
            <div class="skeleton" style="width: 52%" />
            <div class="skeleton" style="width: 74%; height: 24px" />
          </div>
        </div>
        <div class="card"><div class="card-body"><TableSkeleton :rows="4" :cols="4" /></div></div>
      </div>

      <template v-else-if="rapport">
        <!-- Panneaux en v-show : l'impression les revele tous, comme avant les onglets -->

        <!-- Synthese ------------------------------------------------------- -->
        <section v-show="ongletActif === 'synthese'" class="panel stack">
          <div class="grid grid-stats">
            <template v-if="modules.ventes">
              <StatCard label="CA direct" :value="formatMontant(rapport.chiffre_affaires.direct)" icon="cart" tone="accent" />
              <StatCard label="CA vendeuse(s)" :value="formatMontant(rapport.chiffre_affaires.vendeuses)" icon="users" tone="accent" />
              <StatCard label="CA total" :value="formatMontant(rapport.chiffre_affaires.total)" icon="trending" tone="success" />
              <StatCard label="Nombre de ventes" :value="rapport.nombre_ventes" icon="receipt" />
              <StatCard label="Quantite vendue" :value="formatQuantite(rapport.quantite_vendue)" icon="package" />
              <StatCard
                label="Cout des marchandises vendues"
                :value="formatMontant(rapport.cout_marchandises_vendues)"
                icon="boxOut"
                tone="warning"
                hint="Au cout moyen pondere"
              />
            </template>
            <StatCard
              v-if="modules.depenses"
              label="Depenses"
              :value="formatMontant(rapport.depenses_total)"
              icon="wallet"
              tone="danger"
            />
            <StatCard
              label="Bilan net"
              :value="formatMontant(rapport.bilan_net)"
              icon="chart"
              :tone="Number(rapport.bilan_net) < 0 ? 'danger' : 'success'"
              hint="Ventes moins couts et depenses"
            />
          </div>

          <div v-if="modules.ventes" class="card">
            <div class="card-head">
              <div class="card-head-text">
                <h2>Evolution du chiffre d'affaires</h2>
                <p class="card-head-sub">Un point par jour sur la periode selectionnee</p>
              </div>
              <span v-if="serie.length" class="badge accent tnum">Maximum {{ formatMontant(graphMax) }}</span>
            </div>
            <div class="card-body">
              <EmptyState
                v-if="!serie.length"
                icon="chart"
                title="Aucune donnee sur cette periode"
                desc="Aucune vente n'a ete enregistree entre ces deux dates."
              />
              <svg
                v-else
                :viewBox="`0 0 ${GRAPH_W} ${GRAPH_H}`"
                preserveAspectRatio="xMidYMid meet"
                class="graph"
                role="img"
                aria-label="Chiffre d'affaires par jour sur la periode selectionnee"
              >
                <g v-for="g in graphGraduations" :key="g.ratio">
                  <line
                    :x1="GRAPH_PAD_LEFT"
                    :y1="g.y"
                    :x2="GRAPH_W - GRAPH_PAD_RIGHT"
                    :y2="g.y"
                    class="graph-grille"
                    :class="{ 'is-base': g.ratio === 0 }"
                  />
                  <text :x="GRAPH_PAD_LEFT - 8" :y="g.y + 3.5" text-anchor="end" class="graph-axe-y">
                    {{ formatMontantCourt(g.valeur) }}
                  </text>
                </g>

                <g v-for="b in graphBarres" :key="b.jour">
                  <path :d="graphBarPath(b)" class="graph-barre">
                    <title>{{ formatJourCourt(b.jour) }} : {{ formatMontant(b.valeur) }}</title>
                  </path>
                  <text
                    v-if="b.afficherLabel"
                    :x="b.x + b.largeur / 2"
                    :y="GRAPH_H - 8"
                    text-anchor="middle"
                    class="graph-label"
                  >
                    {{ formatJourCourt(b.jour) }}
                  </text>
                </g>
              </svg>
            </div>
          </div>
        </section>

        <!-- Produits ------------------------------------------------------- -->
        <section v-show="ongletActif === 'produits'" class="panel">
          <div v-if="!modules.ventes || !performanceProduits || !performanceProduits.actif" class="card">
            <EmptyState
              icon="package"
              title="Performance produits indisponible"
              desc="Ce classement demande le module Ventes actif et au moins une vente sur la periode."
            />
          </div>

          <div v-else class="grid grid-2">
            <div class="card">
              <div class="card-head">
                <div class="card-head-text">
                  <h2>Meilleures ventes</h2>
                  <p class="card-head-sub">Les produits qui portent le chiffre d'affaires</p>
                </div>
              </div>
              <div class="card-body card-body-flush">
                <EmptyState
                  v-if="!performanceProduits.meilleures_ventes.length"
                  icon="package"
                  title="Aucune donnee"
                  desc="Aucun produit vendu sur cette periode."
                />
                <div v-else class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style="width: 46px"></th>
                        <th>Produit</th>
                        <th class="td-num">Quantite</th>
                        <th class="td-num">Montant</th>
                        <th class="td-num">Tendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="p in performanceProduits.meilleures_ventes" :key="p.id">
                        <td>
                          <img v-if="p.photo" :src="assetUrl(p.photo, { taille: 'vignette' })" class="thumb" alt="" />
                          <div v-else class="thumb"><Icon name="image" :size="15" /></div>
                        </td>
                        <td class="td-strong">{{ p.nom }}</td>
                        <td class="td-num tnum">{{ formatQuantite(p.quantite_vendue) }}</td>
                        <td class="td-num tnum td-strong">{{ formatMontant(p.montant) }}</td>
                        <td class="td-num">
                          <span class="badge" :class="classeTendance(p.tendance)">{{ texteTendance(p) }}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-head">
                <div class="card-head-text">
                  <h2>Ventes faibles</h2>
                  <p class="card-head-sub">Les produits a relancer ou a arreter</p>
                </div>
              </div>
              <div class="card-body card-body-flush">
                <EmptyState
                  v-if="!performanceProduits.faibles_ventes.length"
                  icon="package"
                  title="Aucune donnee"
                  desc="Aucun produit en retrait sur cette periode."
                />
                <div v-else class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style="width: 46px"></th>
                        <th>Produit</th>
                        <th class="td-num">Quantite</th>
                        <th class="td-num">Montant</th>
                        <th class="td-num">Tendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="p in performanceProduits.faibles_ventes" :key="p.id">
                        <td>
                          <img v-if="p.photo" :src="assetUrl(p.photo, { taille: 'vignette' })" class="thumb" alt="" />
                          <div v-else class="thumb"><Icon name="image" :size="15" /></div>
                        </td>
                        <td class="td-strong">{{ p.nom }}</td>
                        <td class="td-num tnum">{{ formatQuantite(p.quantite_vendue) }}</td>
                        <td class="td-num tnum td-strong">{{ formatMontant(p.montant) }}</td>
                        <td class="td-num">
                          <span class="badge" :class="classeTendance(p.tendance)">{{ texteTendance(p) }}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Vendeuses ------------------------------------------------------ -->
        <section v-if="modules.ventes" v-show="ongletActif === 'vendeuses'" class="panel">
          <div class="card">
            <div class="card-head">
              <div class="card-head-text">
                <h2>{{ vendeuseFiltre ? 'Performance de la vendeuse' : 'Detail par vendeuse' }}</h2>
                <p class="card-head-sub">Total de chacune, du meilleur au moins bon</p>
              </div>
              <span class="small muted">{{ rapport.par_vendeuse.length }} vendeuse(s)</span>
            </div>
            <div class="card-body card-body-flush">
              <EmptyState
                v-if="!rapport.par_vendeuse.length"
                icon="users"
                title="Aucune vente attribuee"
                desc="Aucune vente n'a ete rattachee a une vendeuse sur cette periode."
              />
              <div v-else class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Vendeuse</th>
                      <th class="td-num">Ventes</th>
                      <th class="td-num">Montant</th>
                      <th style="min-width: 190px">Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="v in rapport.par_vendeuse" :key="v.vendeuse_id">
                      <td class="td-strong">{{ v.nom }}</td>
                      <td class="td-num tnum">{{ v.nombre_ventes }}</td>
                      <td class="td-num tnum td-strong">{{ formatMontant(v.montant) }}</td>
                      <td>
                        <div class="row">
                          <div class="jauge flex-1">
                            <div class="jauge-remplissage" :style="{ width: `${Math.min(100, v.taux_contribution * 100)}%` }" />
                          </div>
                          <span class="small tnum nowrap">{{ (v.taux_contribution * 100).toFixed(1) }}%</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.graph { width: 100%; height: 210px; display: block; }
.graph-barre { fill: var(--accent); cursor: pointer; transition: opacity var(--transition); }
.graph-barre:hover { opacity: 0.72; }
.graph-grille { stroke: var(--border); stroke-width: 1; stroke-dasharray: 3 4; }
.graph-grille.is-base { stroke: var(--border-strong); stroke-dasharray: none; }
.graph-label { font-size: 9px; fill: var(--text-muted); }
.graph-axe-y { font-size: 10px; fill: var(--text-muted); font-variant-numeric: tabular-nums; }

.jauge {
  height: 6px;
  border-radius: var(--r-full);
  background: var(--bg-subtle);
  overflow: hidden;
  min-width: 70px;
}
.jauge-remplissage { height: 100%; background: var(--accent); border-radius: var(--r-full); }

@media print {
  /* Une impression doit contenir tout le rapport, pas seulement l'onglet ouvert. */
  .panel { display: block !important; }
  .panel + .panel { margin-top: 16px; }
}
</style>
