<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import api from '../api/client'
import { useModulesStore } from '../stores/modules'
import { useAuthStore } from '../stores/auth'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import StatCard from '../components/ui/StatCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Icon from '../components/ui/Icon.vue'
import ChartLine from '../components/ui/ChartLine.vue'
import ChartBar from '../components/ui/ChartBar.vue'
import ChartDonut from '../components/ui/ChartDonut.vue'
import { TEINTES_CATEGORIES } from '../components/ui/palette'

const modules = useModulesStore()
const auth = useAuthStore()

const loading = ref(true)
const erreur = ref('')

const rapportJour = ref(null)
const alertes = ref([])
const activite = ref(null)
const comparaisonVeille = ref(null)

const variationCa = computed(() => comparaisonVeille.value?.variation_ca_pourcentage ?? null)

const prenom = computed(() => auth.user?.prenom || auth.user?.nom_utilisateur || '')

const dateDuJour = computed(() =>
  new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
)

// Le suivi financier depend des modules : sans Ventes ni Depenses, le tableau
// de bord se limite au stock plutot que d'afficher des zeros trompeurs.
const suiviFinancier = computed(() => modules.ventes || modules.depenses)

/* --- Accueil --------------------------------------------------------------
   L'heure est relue chaque minute : un poste de caisse reste ouvert toute la
   journee, un « Bonjour » fige a 21 h ne veut plus rien dire. */
const maintenant = ref(new Date())
let horloge = null

onMounted(() => {
  horloge = setInterval(() => { maintenant.value = new Date() }, 60_000)
})
onUnmounted(() => clearInterval(horloge))

const salutation = computed(() => {
  const h = maintenant.value.getHours()
  if (h < 5) return 'Bonne nuit'
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon apres-midi'
  return 'Bonsoir'
})

const titreAccueil = computed(() =>
  prenom.value ? `${salutation.value} ${prenom.value}` : 'Tableau de bord'
)

// Une phrase tiree de l'etat reel des donnees, pas une formule de politesse.
// Le plus actionnable passe devant : un stock sous le seuil se traite le jour
// meme, une variation de chiffre d'affaires se constate seulement.
const situation = computed(() => {
  if (loading.value) return ''
  if (alertes.value.length) {
    return alertes.value.length === 1
      ? '1 produit sous le seuil d\'alerte'
      : `${alertes.value.length} produits sous le seuil d'alerte`
  }
  if (!rapportJour.value) return ''
  if (modules.ventes && Number(rapportJour.value.nombre_ventes) === 0) {
    return 'Aucune vente encore aujourd\'hui'
  }
  if (variationCa.value !== null) {
    const v = variationCa.value
    const signe = v > 0 ? '+' : v < 0 ? '−' : ''
    return `${signe}${Math.abs(v).toFixed(0)} % de chiffre d'affaires par rapport a hier`
  }
  if (modules.ventes && Number(rapportJour.value.nombre_ventes) > 0) {
    return `${rapportJour.value.nombre_ventes} vente(s) aujourd'hui, ${formatMontant(rapportJour.value.chiffre_affaires.total)}`
  }
  return 'Tous les stocks sont au-dessus de leur seuil'
})

const sousTitre = computed(() =>
  situation.value ? `${dateDuJour.value} — ${situation.value}` : dateDuJour.value
)

/* --- Graphiques ----------------------------------------------------------- */

const JOURS = 30
const chargementGraphiques = ref(true)
const serie = ref([])
const topProduits = ref([])
const depensesPeriode = ref([])

function cleJour(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function plage() {
  const debut = new Date()
  debut.setDate(debut.getDate() - (JOURS - 1))
  debut.setHours(0, 0, 0, 0)
  return { from: debut.toISOString(), to: new Date().toISOString(), debut }
}

// Le serveur ne renvoie que les jours ou il s'est passe quelque chose. Tracer
// directement ce tableau raccourcirait l'axe et ferait passer un trou de trois
// jours sans vente pour une journee normale : on rebatit les 30 jours et les
// jours absents valent zero.
const serieCompletee = computed(() => {
  const { debut } = plage()
  const parJour = new Map(serie.value.map((j) => [j.jour, j]))
  const jours = []
  for (let i = 0; i < JOURS; i += 1) {
    const d = new Date(debut)
    d.setDate(d.getDate() + i)
    const cle = cleJour(d)
    const trouve = parJour.get(cle)
    jours.push({
      label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      ca: Number(trouve?.chiffre_affaires || 0),
      depenses: Number(trouve?.depenses || 0),
    })
  }
  return jours
})

const seriesTendance = computed(() => {
  const liste = []
  if (modules.ventes) {
    liste.push({
      label: 'Chiffre d\'affaires',
      couleur: TEINTES_CATEGORIES[0],
      points: serieCompletee.value.map((j) => ({ x: j.label, y: j.ca })),
    })
  }
  if (modules.depenses) {
    liste.push({
      label: 'Depenses',
      couleur: TEINTES_CATEGORIES[1],
      points: serieCompletee.value.map((j) => ({ x: j.label, y: j.depenses })),
    })
  }
  return liste
})

const barresTopProduits = computed(() =>
  topProduits.value.map((p) => ({ label: p.nom, valeur: Number(p.quantite_vendue) }))
)

// Il n'existe pas d'endpoint de repartition des depenses : /depenses renvoie
// les lignes brutes (categorie + montant), l'agregation se fait donc ici.
// Aucune route n'a ete inventee cote serveur.
const repartitionDepenses = computed(() => {
  const parCategorie = new Map()
  for (const d of depensesPeriode.value) {
    const cle = d.categorie || 'Non classe'
    parCategorie.set(cle, (parCategorie.get(cle) || 0) + Number(d.montant || 0))
  }
  return Array.from(parCategorie, ([label, valeur]) => ({ label, valeur }))
})

async function chargerGraphiques() {
  chargementGraphiques.value = true
  const { from, to } = plage()
  try {
    const [serieRes, produitsRes, depensesRes] = await Promise.all([
      suiviFinancier.value
        ? api.get('/rapports/serie', { params: { from, to } })
        : Promise.resolve({ data: { serie: [] } }),
      modules.ventes
        ? api.get('/rapports/performance-produits', { params: { from, to, limite: 5 } })
        : Promise.resolve({ data: null }),
      modules.depenses
        ? api.get('/depenses', { params: { from, to } })
        : Promise.resolve({ data: [] }),
    ])
    serie.value = serieRes.data?.serie || []
    topProduits.value = produitsRes.data?.meilleures_ventes || []
    depensesPeriode.value = Array.isArray(depensesRes.data) ? depensesRes.data : []
  } catch {
    // Un graphique indisponible ne doit pas vider le tableau de bord : les
    // chiffres du jour restent affiches, les cartes de graphique montrent
    // leur etat vide.
    serie.value = []
    topProduits.value = []
    depensesPeriode.value = []
  } finally {
    chargementGraphiques.value = false
  }
}

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const [rapportRes, alertesRes, activiteRes, comparaisonRes] = await Promise.all([
      api.get('/rapports/journalier'),
      api.get('/stock/alertes'),
      api.get('/rapports/activite-recente?limite=6'),
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
  await chargerGraphiques()
}

onMounted(charger)
</script>

<template>
  <div>
    <PageHeader :title="titreAccueil" :subtitle="sousTitre">
      <template #actions>
        <button type="button" @click="charger" :disabled="loading">
          <Icon name="refresh" :size="15" /> Actualiser
        </button>
        <RouterLink v-if="modules.ventes" to="/ventes" class="btn btn-primary">
          <Icon name="plus" :size="15" /> Nouvelle vente
        </RouterLink>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div v-if="loading" class="grid grid-stats mb-4">
      <div v-for="i in 4" :key="i" class="stat">
        <div class="skeleton" style="width: 55%" />
        <div class="skeleton" style="width: 75%; height: 26px" />
      </div>
    </div>

    <template v-else-if="rapportJour">
      <div class="grid grid-stats mb-4">
        <StatCard
          v-if="modules.ventes"
          label="Chiffre d'affaires du jour"
          :value="formatMontant(rapportJour.chiffre_affaires.total)"
          icon="wallet"
          tone="accent"
          :trend="variationCa"
          trend-label="vs hier"
        />
        <StatCard
          v-if="modules.ventes"
          label="Ventes du jour"
          :value="rapportJour.nombre_ventes"
          icon="cart"
          :hint="`${formatQuantite(rapportJour.quantite_vendue)} article(s)`"
        />
        <StatCard
          v-if="suiviFinancier"
          label="Bilan net du jour"
          :value="formatMontant(rapportJour.bilan_net)"
          icon="trending"
          :tone="Number(rapportJour.bilan_net) >= 0 ? 'success' : 'danger'"
          hint="Ventes moins couts et depenses"
        />
        <StatCard
          label="Produits en alerte"
          :value="alertes.length"
          icon="warning"
          :tone="alertes.length ? 'danger' : 'success'"
          :hint="alertes.length ? 'Stock au niveau du seuil' : 'Tous les stocks sont bons'"
        />
      </div>

      <div v-if="!suiviFinancier" class="card mb-4">
        <div class="card-body row" style="align-items: flex-start; gap: 12px">
          <span class="stat-icon is-accent"><Icon name="info" :size="15" /></span>
          <div class="flex-1">
            <p class="strong">Suivi financier desactive</p>
            <p class="small muted mt-2">
              Les modules Ventes et Depenses sont eteints : ce tableau de bord se limite au stock.
              Reactivez-les depuis Parametres pour retrouver le chiffre d'affaires et le bilan.
            </p>
            <RouterLink to="/parametres" class="btn btn-sm mt-3">Ouvrir les parametres</RouterLink>
          </div>
        </div>
      </div>

      <!-- Tendance sur 30 jours -->
      <div v-if="suiviFinancier" class="card mb-4">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Tendance sur 30 jours</h2>
            <p class="card-head-sub">
              <template v-if="modules.ventes && modules.depenses">
                Chiffre d'affaires et depenses, jour par jour
              </template>
              <template v-else-if="modules.ventes">Chiffre d'affaires, jour par jour</template>
              <template v-else>Depenses, jour par jour</template>
            </p>
          </div>
          <RouterLink to="/rapports" class="btn btn-sm btn-ghost">Rapports detailles</RouterLink>
        </div>
        <div class="card-body">
          <div v-if="chargementGraphiques" class="skeleton chart-skeleton" style="height: 210px" />
          <ChartLine
            v-else
            :series="seriesTendance"
            :height="210"
            :format-y="formatMontant"
            vide-titre="Aucun mouvement sur 30 jours"
            vide-texte="Les ventes et depenses enregistrees dessineront la courbe ici."
          />
        </div>
      </div>

      <div class="grid-graphiques mb-4">
        <!-- Top produits -->
        <div v-if="modules.ventes" class="card">
          <div class="card-head">
            <div class="card-head-text">
              <h2>Produits les plus vendus</h2>
              <p class="card-head-sub">Quantites vendues sur 30 jours</p>
            </div>
          </div>
          <div class="card-body">
            <div v-if="chargementGraphiques" class="skeleton chart-skeleton" style="height: 170px" />
            <ChartBar
              v-else
              :data="barresTopProduits"
              :format-valeur="formatQuantite"
              vide-titre="Aucune vente sur 30 jours"
              vide-texte="Le classement apparaitra des la premiere vente enregistree."
            />
          </div>
        </div>

        <!-- Repartition des depenses -->
        <div v-if="modules.depenses" class="card">
          <div class="card-head">
            <div class="card-head-text">
              <h2>Depenses par categorie</h2>
              <p class="card-head-sub">Repartition sur 30 jours</p>
            </div>
          </div>
          <div class="card-body">
            <div v-if="chargementGraphiques" class="skeleton chart-skeleton" style="height: 170px" />
            <ChartDonut
              v-else
              :data="repartitionDepenses"
              :format-valeur="formatMontant"
              libelle-total="sur 30 jours"
              vide-titre="Aucune depense sur 30 jours"
              vide-texte="Les depenses saisies se repartiront ici par categorie."
            />
          </div>
        </div>
      </div>

      <div v-if="alertes.length" class="card mb-4">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Stock a reapprovisionner</h2>
            <p class="card-head-sub">{{ alertes.length }} produit(s) au niveau ou sous le seuil d'alerte</p>
          </div>
          <RouterLink to="/stock" class="btn btn-sm">
            Voir le stock <Icon name="arrowRight" :size="14" />
          </RouterLink>
        </div>
        <div class="card-body card-body-flush">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th class="td-num">Stock restant</th>
                  <th class="td-num">Seuil</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in alertes.slice(0, 6)" :key="p.id">
                  <td class="td-strong">{{ p.nom }}</td>
                  <td class="td-num">
                    <span class="badge danger">{{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }}</span>
                  </td>
                  <td class="td-num tnum muted">{{ formatQuantite(p.seuil_alerte) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="alertes.length > 6" class="card-foot">
          <span class="small muted">et {{ alertes.length - 6 }} autre(s)</span>
        </div>
      </div>

      <div class="grid grid-2">
        <div v-if="modules.ventes" class="card">
          <div class="card-head">
            <div class="card-head-text"><h2>Dernieres ventes</h2></div>
            <RouterLink to="/ventes" class="btn btn-sm btn-ghost">Tout voir</RouterLink>
          </div>
          <div class="card-body card-body-flush">
            <div v-if="activite.dernieres_ventes.length" class="table-wrap">
              <table>
                <tbody>
                  <tr v-for="v in activite.dernieres_ventes" :key="v.id">
                    <td>
                      <span class="badge" :class="v.type === 'directe' ? 'info' : 'accent'">
                        {{ v.type === 'directe' ? 'Boutique' : v.vendeuse_nom }}
                      </span>
                    </td>
                    <td class="td-strong td-num">{{ formatMontant(v.montant_total) }}</td>
                    <td class="td-num small muted nowrap">{{ formatDate(v.date) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <EmptyState v-else icon="cart" title="Aucune vente" desc="Les ventes enregistrees apparaitront ici." />
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-head-text"><h2>Mouvements de stock</h2></div>
            <RouterLink to="/stock" class="btn btn-sm btn-ghost">Tout voir</RouterLink>
          </div>
          <div class="card-body card-body-flush">
            <div v-if="activite.derniers_mouvements_stock.length" class="table-wrap">
              <table>
                <tbody>
                  <tr v-for="m in activite.derniers_mouvements_stock" :key="m.id">
                    <td class="td-strong">{{ m.produit_nom }}</td>
                    <td>
                      <span class="badge" :class="m.type === 'entree' ? 'success' : 'warning'">
                        <Icon :name="m.type === 'entree' ? 'boxIn' : 'boxOut'" :size="12" />
                        {{ m.type === 'entree' ? 'Entree' : 'Sortie' }}
                      </span>
                    </td>
                    <td class="td-num tnum">{{ formatQuantite(m.quantite) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <EmptyState v-else icon="layers" title="Aucun mouvement" desc="Entrees et sorties de stock s'afficheront ici." />
          </div>
        </div>

        <div v-if="modules.depenses" class="card">
          <div class="card-head">
            <div class="card-head-text"><h2>Dernieres depenses</h2></div>
            <RouterLink to="/depenses" class="btn btn-sm btn-ghost">Tout voir</RouterLink>
          </div>
          <div class="card-body card-body-flush">
            <div v-if="activite.dernieres_depenses.length" class="table-wrap">
              <table>
                <tbody>
                  <tr v-for="d in activite.dernieres_depenses" :key="d.id">
                    <td><span class="badge">{{ d.categorie }}</span></td>
                    <td class="td-strong td-num">{{ formatMontant(d.montant) }}</td>
                    <td class="td-num small muted nowrap">{{ formatDate(d.date) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <EmptyState v-else icon="receipt" title="Aucune depense" desc="Les depenses saisies apparaitront ici." />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* minmax(0, 1fr) et jamais 1fr : `1fr` vaut `minmax(auto, 1fr)`, dont la borne
   basse est la largeur minimale du contenu. Un SVG ou un tableau large refuse
   alors de retrecir et fait deborder toute la page sur un ecran de 375 px. */
.grid-graphiques {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}
@media (min-width: 900px) {
  .grid-graphiques { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .grid-graphiques { gap: 10px; }
}

/* Le squelette occupe exactement la hauteur du graphique a venir : sans cela
   la page saute au moment ou la courbe arrive. */
.chart-skeleton { width: 100%; }
</style>
