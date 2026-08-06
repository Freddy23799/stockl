<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api/client'
import { useToastStore } from '../stores/toasts'
import { telechargerDocument, nommerDocument } from '../utils/telecharger'
import { formatMontant, formatDate, formatDateCourt } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import BoutonExport from '../components/ui/BoutonExport.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import StatCard from '../components/ui/StatCard.vue'
import Pagination from '../components/ui/Pagination.vue'
import ChartBar from '../components/ui/ChartBar.vue'
import Icon from '../components/ui/Icon.vue'

const router = useRouter()
const toasts = useToastStore()

const ongletActif = ref('cycles')
const onglets = computed(() => [
  { id: 'cycles', label: 'Fiches de paie', icon: 'wallet', count: totalCycles.value },
  { id: 'recus', label: 'Historique des recus', icon: 'receipt', count: totalRecus.value },
  { id: 'stats', label: 'Statistiques', icon: 'chart' },
])

const erreur = ref('')

/* --- Onglet 1 : cycles ---------------------------------------------------- */

const cycles = ref([])
const totalCycles = ref(0)
const pageCycles = ref(1)
const chargementCycles = ref(false)
const pageSize = 20

// L'engagement en cours est la question qu'on se pose avant de decaisser :
// combien reste-t-il a sortir sur les cycles ouverts.
const engagementTotal = computed(() =>
  cycles.value.reduce((s, c) => s + (c.statut === 'ouvert' ? Number(c.reste_a_payer) : 0), 0)
)
const cyclesOuverts = computed(() => cycles.value.filter((c) => c.statut === 'ouvert').length)

async function chargerCycles() {
  chargementCycles.value = true
  try {
    const { data } = await api.get('/paie/cycles', { params: { page: pageCycles.value, pageSize } })
    cycles.value = data.data
    totalCycles.value = data.total
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    chargementCycles.value = false
  }
}

function avancement(cycle) {
  const total = Number(cycle.total_a_payer)
  if (!total) return 0
  return Math.round((Number(cycle.total_paye) / total) * 100)
}

function ouvrirCycle(cycle) {
  router.push({ name: 'paie-cycle', params: { id: cycle.id } })
}

/* --- Creation d'un cycle -------------------------------------------------- */

const formVisible = ref(false)
const form = reactive({
  libelle: '', periode_debut: '', periode_fin: '',
  ajustement_sens: '', ajustement_mode: 'pourcentage', ajustement_valeur: '', ajustement_motif: '',
})
const formErreur = ref('')
const soumission = ref(false)

// Le mois precedent est le cas de loin le plus frequent : on le propose plutot
// que de laisser deux champs vides a remplir a la main chaque fois.
function moisPrecedent() {
  const maintenant = new Date()
  const debut = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1)
  const fin = new Date(maintenant.getFullYear(), maintenant.getMonth(), 0)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
  return {
    debut: iso(debut),
    fin: iso(fin),
    libelle: `Salaires ${MOIS[debut.getMonth()]} ${debut.getFullYear()}`,
  }
}

function ouvrirForm() {
  const m = moisPrecedent()
  Object.assign(form, {
    libelle: m.libelle, periode_debut: m.debut, periode_fin: m.fin,
    ajustement_sens: '', ajustement_mode: 'pourcentage', ajustement_valeur: '', ajustement_motif: '',
  })
  formErreur.value = ''
  formVisible.value = true
}

const effectifPrevu = ref(null)

// Combien d'employes seront concernes : on le dit AVANT de creer, pour eviter la
// surprise d'un cycle vide ou d'un cycle qui embarque quelqu'un par erreur.
async function estimerEffectif() {
  try {
    const { data } = await api.get('/employes')
    effectifPrevu.value = data.filter((e) => e.actif && e.salaire_actuel).length
  } catch {
    effectifPrevu.value = null
  }
}

watch(formVisible, (ouvert) => { if (ouvert) estimerEffectif() })

async function soumettre() {
  formErreur.value = ''
  soumission.value = true
  try {
    const charge = {
      libelle: form.libelle || null,
      periode_debut: form.periode_debut,
      periode_fin: form.periode_fin,
    }
    if (form.ajustement_sens) {
      charge.ajustement_sens = form.ajustement_sens
      charge.ajustement_mode = form.ajustement_mode
      charge.ajustement_valeur = Number(form.ajustement_valeur)
      charge.ajustement_motif = form.ajustement_motif || null
    }
    const { data } = await api.post('/paie/cycles', charge)
    formVisible.value = false
    toasts.succes(`Fiche de paie creee — ${data.effectif} employe(s)`)
    await chargerCycles()
    router.push({ name: 'paie-cycle', params: { id: data.id } })
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de la creation'
  } finally {
    soumission.value = false
  }
}

/* --- Onglet 2 : recus ----------------------------------------------------- */

const recus = ref([])
// `null` tant que rien n'a ete charge : afficher "0" avant d'avoir demande la
// liste annonce une absence de recus qui est fausse.
const totalRecus = ref(null)
const pageRecus = ref(1)
const rechercheRecu = ref('')
const chargementRecus = ref(false)

async function chargerRecus() {
  chargementRecus.value = true
  try {
    const params = { page: pageRecus.value, pageSize }
    if (rechercheRecu.value.trim()) params.recherche = rechercheRecu.value.trim()
    const { data } = await api.get('/paie/recus', { params })
    recus.value = data.data
    totalRecus.value = data.total
  } finally {
    chargementRecus.value = false
  }
}

let minuteurRecherche = null
watch(rechercheRecu, () => {
  clearTimeout(minuteurRecherche)
  minuteurRecherche = setTimeout(() => { pageRecus.value = 1; chargerRecus() }, 300)
})

async function telechargerRecu(numero) {
  await telechargerDocument(`/exports/recus/${numero}.pdf`, {
    libelle: `Recu ${numero}`,
    nomFichier: nommerDocument(`recu-${numero}`),
  })
}

/* --- Onglet 3 : statistiques ---------------------------------------------- */

const stats = ref(null)
const filtresStats = reactive({ from: '', to: '' })
const chargementStats = ref(false)

async function chargerStats() {
  chargementStats.value = true
  try {
    const params = {}
    if (filtresStats.from) params.from = filtresStats.from
    if (filtresStats.to) params.to = filtresStats.to
    const { data } = await api.get('/paie/statistiques', { params })
    stats.value = data
  } finally {
    chargementStats.value = false
  }
}

const donneesParEmploye = computed(() =>
  (stats.value?.par_employe || []).slice(0, 8).map((e) => ({
    label: e.nom_complet,
    valeur: Number(e.total_verse),
  }))
)

const donneesParMois = computed(() =>
  (stats.value?.par_mois || []).map((m) => ({
    label: m.mois,
    valeur: Number(m.montant),
  }))
)

watch(ongletActif, (onglet) => {
  if (onglet === 'recus' && !recus.value.length) chargerRecus()
  if (onglet === 'stats' && !stats.value) chargerStats()
})

onMounted(chargerCycles)
</script>

<template>
  <div>
    <PageHeader
      title="Paie"
      subtitle="Etablissez les fiches de paie, enregistrez les versements et retrouvez chaque recu."
    >
      <template #actions>
        <BoutonExport
          v-if="ongletActif === 'stats'"
          chemin="/exports/statistiques-paie.pdf"
          :params="filtresStats"
          libelle="Statistiques de paie"
          fichier="statistiques-paie"
        />
        <button type="button" class="primary" @click="ouvrirForm">
          <Icon name="plus" :size="15" /> Nouvelle fiche de paie
        </button>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <!-- ============ Onglet Fiches de paie ============ -->
    <div v-show="ongletActif === 'cycles'">
      <div class="grid grid-stats mb-4">
        <StatCard label="Fiches de paie" :value="totalCycles" icon="wallet" tone="accent" />
        <StatCard
          label="Fiches ouvertes"
          :value="cyclesOuverts"
          icon="clipboard"
          :tone="cyclesOuverts ? 'warning' : 'success'"
        />
        <StatCard
          label="Reste a verser"
          :value="formatMontant(engagementTotal)"
          icon="banknote"
          :tone="engagementTotal ? 'danger' : 'success'"
          hint="Sur les fiches ouvertes affichees"
        />
      </div>

      <div class="card">
        <div class="card-body card-body-flush">
          <TableSkeleton v-if="chargementCycles" :rows="5" :cols="5" />

          <EmptyState
            v-else-if="!cycles.length"
            icon="wallet"
            title="Aucune fiche de paie"
            desc="Creez une fiche pour une periode : tous les employes en poste y sont inscrits automatiquement, avec leur salaire en vigueur."
          >
            <button type="button" class="primary" @click="ouvrirForm">
              <Icon name="plus" :size="15" /> Nouvelle fiche de paie
            </button>
          </EmptyState>

          <div v-else class="table-wrap">
            <table class="table-cards">
              <thead>
                <tr>
                  <th>Periode</th>
                  <th class="td-num">Effectif</th>
                  <th class="td-num">A payer</th>
                  <th class="td-num">Reste</th>
                  <th>Avancement</th>
                  <th class="td-actions"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in cycles" :key="c.id" class="ligne-cliquable" @click="ouvrirCycle(c)">
                  <td data-label="Periode" class="td-titre">
                    <div class="td-strong">{{ c.libelle || `Periode ${c.reference}` }}</div>
                    <div class="small muted">
                      {{ formatDateCourt(c.periode_debut) }} au {{ formatDateCourt(c.periode_fin) }}
                      <span class="mono"> · {{ c.reference }}</span>
                    </div>
                  </td>
                  <td data-label="Effectif" class="td-num tnum">{{ c.effectif }}</td>
                  <td data-label="A payer" class="td-num tnum td-strong">{{ formatMontant(c.total_a_payer) }}</td>
                  <td data-label="Reste" class="td-num tnum">
                    <span :class="Number(c.reste_a_payer) > 0 ? 'reste-du' : 'muted'">
                      {{ formatMontant(c.reste_a_payer) }}
                    </span>
                  </td>
                  <td data-label="Avancement">
                    <div class="row" style="gap: 8px">
                      <div class="jauge">
                        <!-- Pas d'espace avant le %, sinon `width: 0 %` est une
                             valeur CSS invalide : le navigateur l'ignore et la
                             barre s'affiche pleine quel que soit l'avancement. -->
                        <div class="jauge-remplie" :style="{ width: `${avancement(c)}%` }" />
                      </div>
                      <span class="small tnum">{{ avancement(c) }} %</span>
                    </div>
                    <div class="small muted mt-1">{{ c.nombre_payes }} / {{ c.effectif }} soldes</div>
                  </td>
                  <td data-label="" class="td-actions">
                    <span v-if="c.statut === 'cloture'" class="badge">Cloturee</span>
                    <button type="button" class="btn-sm btn-ghost" title="Ouvrir" @click.stop="ouvrirCycle(c)">
                      <Icon name="arrowRight" :size="15" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card-foot">
          <Pagination
            :page="pageCycles"
            :page-size="pageSize"
            :total="totalCycles"
            @update:page="(p) => { pageCycles = p; chargerCycles() }"
          />
        </div>
      </div>
    </div>

    <!-- ============ Onglet Recus ============ -->
    <div v-show="ongletActif === 'recus'" class="card">
      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input
            v-model="rechercheRecu"
            type="search"
            placeholder="Numero de recu, matricule, nom ou reference de fiche..."
          />
        </div>
        <span class="small muted">{{ totalRecus }} recu(s)</span>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="chargementRecus" :rows="6" :cols="5" />

        <EmptyState
          v-else-if="!recus.length && rechercheRecu"
          icon="search"
          title="Aucun recu trouve"
          :desc="`Rien ne correspond a « ${rechercheRecu} ».`"
        >
          <button type="button" @click="rechercheRecu = ''">Effacer la recherche</button>
        </EmptyState>

        <EmptyState
          v-else-if="!recus.length"
          icon="receipt"
          title="Aucun recu"
          desc="Chaque versement enregistre produit un recu, retrouvable ici par son numero."
        />

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th style="width: 110px">Numero</th>
                <th>Employe</th>
                <th class="hide-sm">Periode</th>
                <th class="td-num">Montant</th>
                <th>Nature</th>
                <th class="td-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in recus" :key="r.id">
                <td data-label="Numero"><span class="numero-recu">{{ r.numero_recu }}</span></td>
                <td data-label="Employe" class="td-titre">
                  <div class="td-strong">{{ r.nom_complet_snapshot }}</div>
                  <div class="small muted mono">{{ r.matricule_snapshot }}</div>
                </td>
                <td data-label="Periode" class="small muted hide-sm">
                  {{ formatDateCourt(r.periode_debut) }} au {{ formatDateCourt(r.periode_fin) }}
                </td>
                <td data-label="Montant" class="td-num tnum td-strong">{{ formatMontant(r.montant) }}</td>
                <td data-label="Nature">
                  <span class="badge" :class="r.est_solde ? 'success' : 'warning'">
                    {{ r.est_solde ? 'Solde' : 'Acompte' }}
                  </span>
                  <div class="small muted mt-1">{{ formatDate(r.paye_le) }}</div>
                </td>
                <td data-label="" class="td-actions">
                  <button
                    type="button"
                    class="btn-sm btn-ghost"
                    title="Telecharger le recu"
                    @click="telechargerRecu(r.numero_recu)"
                  >
                    <Icon name="download" :size="15" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card-foot">
        <Pagination
          :page="pageRecus"
          :page-size="pageSize"
          :total="totalRecus"
          @update:page="(p) => { pageRecus = p; chargerRecus() }"
        />
      </div>
    </div>

    <!-- ============ Onglet Statistiques ============ -->
    <div v-show="ongletActif === 'stats'">
      <div class="card mb-4">
        <div class="card-head">
          <div class="toolbar" style="width: 100%">
            <div class="field">
              <label>Du</label>
              <input v-model="filtresStats.from" type="date" />
            </div>
            <div class="field">
              <label>Au</label>
              <input v-model="filtresStats.to" type="date" />
            </div>
            <div class="field">
              <label>&nbsp;</label>
              <button type="button" class="primary" @click="chargerStats">
                <Icon name="filter" :size="15" /> Appliquer
              </button>
            </div>
            <div v-if="filtresStats.from || filtresStats.to" class="field">
              <label>&nbsp;</label>
              <button type="button" class="btn-ghost" @click="filtresStats.from = ''; filtresStats.to = ''; chargerStats()">
                Toute la periode
              </button>
            </div>
          </div>
        </div>
      </div>

      <template v-if="stats">
        <div class="grid grid-stats mb-4">
          <StatCard
            label="Total verse"
            :value="formatMontant(stats.global.total_verse)"
            icon="banknote"
            tone="accent"
            :hint="`${stats.global.nombre_versements} versement(s)`"
          />
          <StatCard label="Employes payes" :value="stats.global.employes_payes" icon="users" />
          <StatCard
            label="Versement moyen"
            :value="formatMontant(stats.global.nombre_versements ? stats.global.total_verse / stats.global.nombre_versements : 0)"
            icon="trending"
          />
          <StatCard
            label="Engagement en cours"
            :value="formatMontant(stats.engagement.reste_a_payer)"
            icon="warning"
            :tone="Number(stats.engagement.reste_a_payer) > 0 ? 'danger' : 'success'"
            :hint="`${stats.engagement.lignes_en_attente} ligne(s) en attente`"
          />
        </div>

        <div class="grid grid-2 mb-4">
          <div v-if="donneesParMois.length" class="card">
            <div class="card-head">
              <div class="card-head-text">
                <h2>Depenses de paie par mois</h2>
                <p class="card-head-sub">Sommes reellement versees</p>
              </div>
            </div>
            <div class="card-body">
              <ChartBar :data="donneesParMois" :format-valeur="formatMontant" />
            </div>
          </div>

          <div v-if="donneesParEmploye.length" class="card">
            <div class="card-head">
              <div class="card-head-text">
                <h2>Par employe</h2>
                <p class="card-head-sub">Les huit premiers</p>
              </div>
            </div>
            <div class="card-body">
              <ChartBar :data="donneesParEmploye" :format-valeur="formatMontant" />
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-head-text"><h2>Detail par employe</h2></div>
          </div>
          <div class="card-body card-body-flush">
            <EmptyState
              v-if="!stats.par_employe.length"
              icon="wallet"
              title="Aucun versement"
              desc="Aucun paiement n'a ete enregistre sur cette periode."
            />
            <div v-else class="table-wrap">
              <table class="table-cards">
                <thead>
                  <tr>
                    <th>Employe</th>
                    <th class="hide-sm">Fonction</th>
                    <th class="td-num">Versements</th>
                    <th class="hide-sm">Dernier paiement</th>
                    <th class="td-num">Total percu</th>
                    <th class="td-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="e in stats.par_employe" :key="e.employe_id">
                    <td data-label="Employe" class="td-titre">
                      <div class="td-strong">{{ e.nom_complet }}</div>
                      <div class="small muted mono">{{ e.matricule }}</div>
                    </td>
                    <td data-label="Fonction" class="hide-sm">
                      <span v-if="e.fonction" class="badge">{{ e.fonction }}</span>
                    </td>
                    <td data-label="Versements" class="td-num tnum">{{ e.versements }}</td>
                    <td data-label="Dernier paiement" class="small muted hide-sm">{{ formatDate(e.dernier_paiement) }}</td>
                    <td data-label="Total percu" class="td-num tnum td-strong">{{ formatMontant(e.total_verse) }}</td>
                    <td data-label="" class="td-actions">
                      <RouterLink
                        :to="{ name: 'employe-detail', params: { id: e.employe_id } }"
                        class="btn btn-sm btn-ghost"
                        title="Ouvrir la fiche"
                      >
                        <Icon name="eye" :size="15" />
                      </RouterLink>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ============ Creation d'une fiche ============ -->
    <Modal v-if="formVisible" title="Nouvelle fiche de paie" @close="formVisible = false">
      <form id="form-cycle" @submit.prevent="soumettre">
        <p class="small muted mb-3">
          Tous les employes en poste ayant un salaire defini sur cette periode y sont
          inscrits automatiquement, avec le salaire en vigueur a la fin de la periode.
        </p>

        <div class="field">
          <label>Intitule <span class="muted">(optionnel)</span></label>
          <input v-model="form.libelle" type="text" maxlength="150" placeholder="Salaires juillet 2026" />
        </div>

        <div class="field-row">
          <div class="field">
            <label>Du <span class="champ-requis">*</span></label>
            <input v-model="form.periode_debut" type="date" required />
          </div>
          <div class="field">
            <label>Au <span class="champ-requis">*</span></label>
            <input v-model="form.periode_fin" type="date" required />
          </div>
        </div>

        <!-- Ajustement general : une prime ou une retenue appliquee a tout le
             monde. Ce n'est PAS un changement de salaire, et il ne touche pas
             a la carriere des employes. -->
        <div class="field">
          <label>Ajustement applique a tout le monde</label>
          <div class="btn-group">
            <button type="button" :class="{ 'is-active': form.ajustement_sens === '' }" @click="form.ajustement_sens = ''">
              Aucun
            </button>
            <button type="button" :class="{ 'is-active': form.ajustement_sens === 'augmentation' }" @click="form.ajustement_sens = 'augmentation'">
              <Icon name="arrowUp" :size="14" /> Prime
            </button>
            <button type="button" :class="{ 'is-active': form.ajustement_sens === 'diminution' }" @click="form.ajustement_sens = 'diminution'">
              <Icon name="arrowDown" :size="14" /> Retenue
            </button>
          </div>
          <span class="field-hint">
            Ponctuel, valable pour cette fiche seulement. Le salaire des employes n'est pas modifie.
          </span>
        </div>

        <template v-if="form.ajustement_sens">
          <div class="field-row">
            <div class="field">
              <label>Mode</label>
              <select v-model="form.ajustement_mode">
                <option value="pourcentage">Pourcentage du salaire</option>
                <option value="montant">Montant fixe</option>
              </select>
            </div>
            <div class="field">
              <label>Valeur</label>
              <input v-model="form.ajustement_valeur" type="number" min="0" step="0.01" required />
              <span class="field-hint">{{ form.ajustement_mode === 'pourcentage' ? 'En %' : 'Par employe' }}</span>
            </div>
          </div>
          <div class="field">
            <label>Motif</label>
            <input v-model="form.ajustement_motif" type="text" maxlength="200" placeholder="Prime de fin d'annee..." />
            <span class="field-hint">Ce motif figure sur chaque recu.</span>
          </div>
        </template>

        <div v-if="effectifPrevu !== null" class="alert" :class="effectifPrevu ? 'alert-info' : 'alert-warning'">
          <Icon :name="effectifPrevu ? 'info' : 'warning'" :size="16" />
          <span v-if="effectifPrevu">
            <strong>{{ effectifPrevu }} employe(s)</strong> seront inscrits sur cette fiche.
          </span>
          <span v-else>
            Aucun employe en poste n'a de salaire defini. Completez d'abord les fiches employes.
          </span>
        </div>

        <p v-if="formErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ formErreur }}</span>
        </p>
      </form>

      <template #footer>
        <button type="button" @click="formVisible = false">Annuler</button>
        <button type="submit" form="form-cycle" class="primary" :disabled="soumission || effectifPrevu === 0">
          <span v-if="soumission" class="spinner" />
          Creer la fiche
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.ligne-cliquable { cursor: pointer; }
.ligne-cliquable:hover { background: var(--bg-subtle); }

.numero-recu {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.03em;
}

.reste-du { color: var(--danger); font-weight: 650; }

/* Jauge d'avancement : le rapport paye/du se lit d'un coup d'oeil, ce qu'un
   pourcentage seul ne donne pas dans une liste de vingt lignes. */
.jauge {
  flex: 1;
  min-width: 54px;
  max-width: 110px;
  height: 6px;
  border-radius: 999px;
  background: var(--border);
  overflow: hidden;
}
.jauge-remplie {
  height: 100%;
  border-radius: 999px;
  background: var(--success);
  transition: width 0.25s ease;
}

.champ-requis { color: var(--danger); margin-left: 2px; }
</style>
