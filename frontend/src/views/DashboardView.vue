<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import api from '../api/client'
import { useModulesStore } from '../stores/modules'
import { useAuthStore } from '../stores/auth'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import StatCard from '../components/ui/StatCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Icon from '../components/ui/Icon.vue'

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
}

onMounted(charger)
</script>

<template>
  <div>
    <PageHeader :title="prenom ? `Bonjour ${prenom}` : 'Tableau de bord'" :subtitle="dateDuJour">
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
