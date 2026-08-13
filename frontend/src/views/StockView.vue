<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api, { assetUrl } from '../api/client'
import { useModulesStore } from '../stores/modules'
import { useToastStore } from '../stores/toasts'
import { useAuthStore } from '../stores/auth'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import BoutonExport from '../components/ui/BoutonExport.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import Pagination from '../components/ui/Pagination.vue'
import Icon from '../components/ui/Icon.vue'

const modules = useModulesStore()
const toasts = useToastStore()
const auth = useAuthStore()

const etatStock = ref([])
const produits = ref([])
const fournisseurs = ref([])
const mouvements = ref([])
const loading = ref(true)
const chargementMouvements = ref(false)
const erreur = ref('')

const ongletActif = ref('etat')
const recherche = ref('')

const enAlerte = computed(() => etatStock.value.filter((p) => p.en_alerte))
const valeurTotale = computed(() =>
  etatStock.value.reduce((s, p) => s + Number(p.quantite_stock) * Number(p.cout_moyen_pondere), 0)
)
const ruptures = computed(() => etatStock.value.filter((p) => Number(p.quantite_stock) <= 0))

// Les mouvements et les entrees/ajustements sont reserves a l'admin et au
// gestionnaire de stock (voir routes/stock.routes.js) : le reste des roles
// n'a qu'une lecture de l'etat du stock.
const peutGererStock = computed(() => auth.hasRole('gestionnaire_stock'))

const onglets = computed(() => [
  { id: 'etat', label: 'Etat du stock', icon: 'layers', count: etatStock.value.length },
  ...(peutGererStock.value ? [{ id: 'mouvements', label: 'Mouvements', icon: 'history', count: total.value }] : []),
])

const etatFiltre = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  if (!q) return etatStock.value
  return etatStock.value.filter((p) => p.nom.toLowerCase().includes(q))
})

/* --- Chargement --------------------------------------------------------- */

const filtres = reactive({ produit_id: '', type: '', motif: '', from: '', to: '' })

// Le motif dit ce qui s'est reellement passe ; "Entree"/"Sortie" ne distingue
// pas un ravitaillement d'un retour client, ni une vente d'une casse.
const LIBELLES_MOTIF = {
  ravitaillement: 'Ravitaillement',
  vente: 'Vente',
  inventaire: 'Inventaire',
  perte: 'Perte',
  casse: 'Casse',
  vol: 'Vol',
  retour_client: 'Retour client',
  correction: 'Correction',
}

function libelleMotif(mouvement) {
  return LIBELLES_MOTIF[mouvement.motif] || (mouvement.type === 'entree' ? 'Entree' : 'Sortie')
}

// Une perte se signale en rouge : c'est de l'argent qui sort sans contrepartie,
// et cela ne doit pas se confondre visuellement avec une vente.
function badgeMotif(mouvement) {
  if (['perte', 'casse', 'vol'].includes(mouvement.motif)) return 'danger'
  if (mouvement.motif === 'inventaire' || mouvement.motif === 'correction') return 'info'
  return mouvement.type === 'entree' ? 'success' : 'warning'
}
const page = ref(1)
const pageSize = 20
const total = ref(0)

async function chargerEtat() {
  const { data } = await api.get('/stock')
  etatStock.value = data
}

async function chargerMouvements() {
  chargementMouvements.value = true
  try {
    const params = { page: page.value, pageSize }
    if (filtres.produit_id) params.produit_id = filtres.produit_id
    if (filtres.type) params.type = filtres.type
    if (filtres.motif) params.motif = filtres.motif
    if (filtres.from) params.from = filtres.from
    if (filtres.to) params.to = filtres.to
    const { data } = await api.get('/stock/mouvements', { params })
    mouvements.value = data.data
    total.value = data.total
  } finally {
    chargementMouvements.value = false
  }
}

function filtrerMouvements() {
  page.value = 1
  chargerMouvements()
}

function reinitialiserFiltres() {
  Object.assign(filtres, { produit_id: '', type: '', motif: '', from: '', to: '' })
  filtrerMouvements()
}

const filtresActifs = computed(() =>
  Boolean(filtres.produit_id || filtres.type || filtres.motif || filtres.from || filtres.to)
)

function changerPage(nouvellePage) {
  page.value = nouvellePage
  chargerMouvements()
}

async function chargerReferences() {
  const appels = [api.get('/produits')]
  if (modules.fournisseurs && peutGererStock.value) appels.push(api.get('/fournisseurs'))
  const [produitsRes, fournisseursRes] = await Promise.all(appels)
  produits.value = produitsRes.data
  fournisseurs.value = fournisseursRes ? fournisseursRes.data : []
}

onMounted(async () => {
  loading.value = true
  erreur.value = ''
  try {
    const appels = [chargerEtat(), chargerReferences()]
    if (peutGererStock.value) appels.push(chargerMouvements())
    await Promise.all(appels)
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
})

/* --- Entree de stock ---------------------------------------------------- */

const entreeVisible = ref(false)
const entree = reactive({ produit_id: '', quantite_achat: '', cout_achat_total: '', fournisseur_id: '' })
const entreeErreur = ref('')
const entreeSoumission = ref(false)

const produitEntree = computed(() =>
  produits.value.find((p) => p.id === Number(entree.produit_id)) || null
)

// Le prix se saisit pour le lot entier, alors que le stock se compte a l'unite
// de reference. Afficher le cout unitaire resultant evite de decouvrir une
// erreur de saisie plus tard, dans les marges.
const apercuEntree = computed(() => {
  const p = produitEntree.value
  const q = Number(entree.quantite_achat)
  const cout = Number(entree.cout_achat_total)
  if (!p || !(q > 0) || !(cout >= 0)) return null
  const quantiteRef = q * Number(p.facteur_conversion)
  if (!(quantiteRef > 0)) return null
  return {
    quantiteRef,
    uniteRef: p.unite_stock,
    coutUnitaire: cout / quantiteRef,
    nouveauStock: Number(p.quantite_stock) + quantiteRef,
  }
})

function ouvrirEntree(produitId = '') {
  Object.assign(entree, { produit_id: produitId, quantite_achat: '', cout_achat_total: '', fournisseur_id: '' })
  entreeErreur.value = ''
  entreeVisible.value = true
}

/* --- Ajustement de stock ------------------------------------------------ */

// Le stock ne pouvait baisser que par une vente. Une boutique perd pourtant de
// la marchandise autrement : casse, vol, erreur de comptage. Sans cet ecran, la
// seule facon de corriger un ecart etait d'enregistrer une fausse vente, ce qui
// gonflait le chiffre d'affaires.
const MOTIFS = [
  { valeur: 'inventaire', label: 'Inventaire physique', aide: "Comptage des rayons : ajuste le stock sur ce qui a ete compte." },
  { valeur: 'casse', label: 'Casse', aide: 'Flacon brise, emballage abime, produit inutilisable.' },
  { valeur: 'perte', label: 'Perte', aide: 'Marchandise egaree ou perimee.' },
  { valeur: 'vol', label: 'Vol', aide: 'Disparition constatee.' },
  { valeur: 'retour_client', label: 'Retour client', aide: 'Un produit vendu revient en stock.' },
  { valeur: 'correction', label: 'Correction de saisie', aide: 'Erreur lors d\'une entree precedente.' },
]

const ajustementVisible = ref(false)
const ajustement = reactive({ produit_id: '', quantite_reelle: '', motif: 'inventaire', note: '' })
const ajustementErreur = ref('')
const ajustementSoumission = ref(false)

const produitAjuste = computed(() =>
  etatStock.value.find((p) => p.id === Number(ajustement.produit_id)) || null
)

const motifChoisi = computed(() => MOTIFS.find((m) => m.valeur === ajustement.motif) || null)

// L'ecart est affiche avant validation : c'est le seul moyen de se rendre compte
// qu'on s'apprete a retirer 300 unites a cause d'une faute de frappe.
const apercuAjustement = computed(() => {
  const p = produitAjuste.value
  if (!p || ajustement.quantite_reelle === '') return null
  const cible = Number(ajustement.quantite_reelle)
  if (!Number.isFinite(cible) || cible < 0) return null
  const actuel = Number(p.quantite_stock)
  const ecart = cible - actuel
  return {
    actuel,
    cible,
    ecart,
    unite: p.unite_stock,
    valeur: Math.abs(ecart) * Number(p.cout_moyen_pondere),
  }
})

function ouvrirAjustement(produitId = '') {
  Object.assign(ajustement, { produit_id: produitId, quantite_reelle: '', motif: 'inventaire', note: '' })
  ajustementErreur.value = ''
  ajustementVisible.value = true
}

async function soumettreAjustement() {
  ajustementErreur.value = ''
  ajustementSoumission.value = true
  try {
    const { data } = await api.post('/stock/ajustements', {
      produit_id: Number(ajustement.produit_id),
      quantite_reelle: Number(ajustement.quantite_reelle),
      motif: ajustement.motif,
      note: ajustement.note || null,
    })
    ajustementVisible.value = false
    if (data.ecart === 0) {
      toasts.succes(data.message)
    } else {
      const sens = data.ecart > 0 ? 'ajoutee(s)' : 'retiree(s)'
      toasts.succes(`${formatQuantite(Math.abs(data.ecart))} unite(s) ${sens} — ${produitAjuste.value?.nom}`)
    }
    await Promise.all([chargerEtat(), chargerMouvements(), chargerReferences()])
  } catch (err) {
    ajustementErreur.value = err.response?.data?.message || "Erreur lors de l'ajustement"
  } finally {
    ajustementSoumission.value = false
  }
}

async function soumettreEntree() {
  entreeErreur.value = ''
  entreeSoumission.value = true
  try {
    await api.post('/stock/entrees', {
      produit_id: Number(entree.produit_id),
      quantite_achat: Number(entree.quantite_achat),
      cout_achat_total: Number(entree.cout_achat_total),
      fournisseur_id: modules.fournisseurs && entree.fournisseur_id ? Number(entree.fournisseur_id) : null,
    })
    entreeVisible.value = false
    toasts.succes(`Stock de "${produitEntree.value?.nom}" reapprovisionne`)
    await Promise.all([chargerEtat(), chargerMouvements(), chargerReferences()])
  } catch (err) {
    entreeErreur.value = err.response?.data?.message || 'Erreur lors de l\'entree de stock'
  } finally {
    entreeSoumission.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="Stock" subtitle="Etat en temps reel et journal de tous les mouvements d'entree et de sortie.">
      <template #actions>
        <!-- L'export suit l'onglet consulte : l'inventaire valorise d'un cote,
             le journal des mouvements filtre de l'autre. -->
        <BoutonExport
          v-if="ongletActif === 'etat'"
          chemin="/exports/stock.pdf"
          libelle="Etat du stock"
          fichier="etat-du-stock"
        />
        <BoutonExport
          v-else
          chemin="/exports/mouvements.pdf"
          :params="filtres"
          libelle="Mouvements de stock"
          fichier="mouvements-de-stock"
        />
        <template v-if="peutGererStock">
          <button type="button" @click="ouvrirAjustement()">
            <Icon name="clipboard" :size="15" /> Ajuster / Inventaire
          </button>
          <button type="button" class="primary" @click="ouvrirEntree()">
            <Icon name="boxIn" :size="15" /> Entree de stock
          </button>
        </template>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div class="grid grid-stats mb-4">
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon is-accent"><Icon name="wallet" :size="15" /></span>
          <span class="stat-label">Valeur immobilisee</span>
        </div>
        <div class="stat-value">{{ formatMontant(valeurTotale) }}</div>
        <div class="stat-foot">Au cout moyen pondere</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon" :class="enAlerte.length ? 'is-warning' : 'is-success'">
            <Icon name="warning" :size="15" />
          </span>
          <span class="stat-label">Sous le seuil</span>
        </div>
        <div class="stat-value">{{ enAlerte.length }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon" :class="ruptures.length ? 'is-danger' : 'is-success'">
            <Icon name="inbox" :size="15" />
          </span>
          <span class="stat-label">En rupture</span>
        </div>
        <div class="stat-value">{{ ruptures.length }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon"><Icon name="layers" :size="15" /></span>
          <span class="stat-label">References suivies</span>
        </div>
        <div class="stat-value">{{ etatStock.length }}</div>
      </div>
    </div>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <!-- ============ Etat du stock ============ -->
    <div v-show="ongletActif === 'etat'" class="card">
      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input v-model="recherche" type="search" placeholder="Rechercher un produit..." />
        </div>
        <span class="small muted">{{ etatFiltre.length }} produit(s)</span>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="6" :cols="5" />

        <EmptyState
          v-else-if="!etatFiltre.length && recherche"
          icon="search"
          title="Aucun resultat"
          :desc="`Aucun produit ne correspond a « ${recherche} ».`"
        >
          <button type="button" @click="recherche = ''">Effacer la recherche</button>
        </EmptyState>

        <EmptyState
          v-else-if="!etatFiltre.length"
          icon="layers"
          title="Aucun produit en stock"
          desc="Creez d'abord des produits, puis enregistrez une entree de stock."
        />

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th style="width: 46px"></th>
                <th>Produit</th>
                <th class="td-num">Stock</th>
                <th class="td-num">Seuil</th>
                <th class="td-num hide-sm">Cout moyen</th>
                <th class="td-num">Valeur</th>
                <th class="td-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in etatFiltre" :key="p.id">
                <td data-label="">
                  <img v-if="p.photo" :src="assetUrl(p.photo, { taille: 'vignette' })" class="thumb" alt="" />
                  <div v-else class="thumb"><Icon name="image" :size="15" /></div>
                </td>
                <td data-label="Produit" class="td-titre td-strong">{{ p.nom }}</td>
                <td data-label="Stock" class="td-num">
                  <span class="badge" :class="Number(p.quantite_stock) <= 0 ? 'danger' : p.en_alerte ? 'warning' : 'success'">
                    {{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }}
                  </span>
                </td>
                <td data-label="Seuil" class="td-num tnum muted">{{ formatQuantite(p.seuil_alerte) }}</td>
                <td data-label="Cout moyen" class="td-num tnum hide-sm">{{ formatMontant(p.cout_moyen_pondere) }}</td>
                <td data-label="Valeur" class="td-num tnum td-strong">
                  {{ formatMontant(Number(p.quantite_stock) * Number(p.cout_moyen_pondere)) }}
                </td>
                <td data-label="" class="td-actions">
                  <button v-if="peutGererStock" type="button" class="btn-sm" @click="ouvrirEntree(p.id)">
                    <Icon name="plus" :size="14" /> Reapprovisionner
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============ Mouvements ============ -->
    <div v-show="ongletActif === 'mouvements'" class="card">
      <div class="card-head">
        <div class="toolbar flex-1">
          <div class="field">
            <label>Produit</label>
            <select v-model="filtres.produit_id" @change="filtrerMouvements">
              <option value="">Tous</option>
              <option v-for="p in produits" :key="p.id" :value="p.id">{{ p.nom }}</option>
            </select>
          </div>
          <div class="field">
            <label>Type</label>
            <select v-model="filtres.type" @change="filtrerMouvements">
              <option value="">Tous</option>
              <option value="entree">Entrees</option>
              <option value="sortie">Sorties</option>
            </select>
          </div>
          <div class="field" style="min-width: 160px">
            <label>Motif</label>
            <select v-model="filtres.motif" @change="filtrerMouvements">
              <option value="">Tous</option>
              <!-- "Pertes" regroupe casse, perte et vol : c'est la question
                   qu'on se pose reellement, pas trois questions separees. -->
              <option value="pertes">Pertes (casse, vol...)</option>
              <option value="ravitaillement">Ravitaillement</option>
              <option value="vente">Vente</option>
              <option value="inventaire">Inventaire</option>
              <option value="retour_client">Retour client</option>
              <option value="correction">Correction</option>
            </select>
          </div>
          <div class="field">
            <label>Du</label>
            <input v-model="filtres.from" type="date" @change="filtrerMouvements" />
          </div>
          <div class="field">
            <label>Au</label>
            <input v-model="filtres.to" type="date" @change="filtrerMouvements" />
          </div>
          <button v-if="filtresActifs" type="button" class="btn-ghost" @click="reinitialiserFiltres">
            <Icon name="x" :size="14" /> Effacer
          </button>
        </div>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="chargementMouvements" :rows="6" :cols="5" />

        <EmptyState
          v-else-if="!mouvements.length"
          icon="history"
          :title="filtresActifs ? 'Aucun mouvement sur ces criteres' : 'Aucun mouvement'"
          :desc="filtresActifs ? 'Elargissez la periode ou retirez des filtres.' : 'Chaque entree et chaque vente laisse une trace ici.'"
        >
          <button v-if="filtresActifs" type="button" @click="reinitialiserFiltres">Effacer les filtres</button>
        </EmptyState>

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Type</th>
                <th class="td-num">Quantite</th>
                <th class="td-num">Cout unitaire</th>
                <th v-if="modules.fournisseurs" class="hide-sm">Fournisseur</th>
                <th class="td-num">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in mouvements" :key="m.id">
                <td data-label="Produit" class="td-titre td-strong">{{ m.produit_nom }}</td>
                <td data-label="Type">
                  <span class="badge" :class="badgeMotif(m)">
                    <Icon :name="m.type === 'entree' ? 'boxIn' : 'boxOut'" :size="12" />
                    {{ libelleMotif(m) }}
                  </span>
                  <div v-if="m.note" class="small muted mt-2">{{ m.note }}</div>
                </td>
                <td data-label="Quantite" class="td-num tnum td-strong">{{ formatQuantite(m.quantite) }}</td>
                <td data-label="Cout unitaire" class="td-num tnum muted">{{ formatMontant(m.cout_unitaire) }}</td>
                <td v-if="modules.fournisseurs" data-label="Fournisseur" class="muted hide-sm">{{ m.fournisseur_nom || '—' }}</td>
                <td data-label="Date" class="td-num small muted nowrap">{{ formatDate(m.date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="mouvements.length" class="card-foot">
        <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="changerPage" />
      </div>
    </div>

    <!-- ============ Modale ajustement / inventaire ============ -->
    <Modal v-if="ajustementVisible" title="Ajuster le stock" @close="ajustementVisible = false">
      <form id="form-ajustement" @submit.prevent="soumettreAjustement">
        <p class="small muted mb-3">
          Corrigez le stock quand la realite ne correspond plus a ce qui est enregistre :
          comptage des rayons, casse, vol, retour. Le mouvement est trace, mais il n'entre
          jamais dans le chiffre d'affaires.
        </p>

        <div class="field">
          <label>Produit</label>
          <select v-model="ajustement.produit_id" required>
            <option value="" disabled>Choisir un produit</option>
            <option v-for="p in etatStock" :key="p.id" :value="p.id">
              {{ p.nom }} — {{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }} en stock
            </option>
          </select>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Motif</label>
            <select v-model="ajustement.motif" required>
              <option v-for="m in MOTIFS" :key="m.valeur" :value="m.valeur">{{ m.label }}</option>
            </select>
            <span v-if="motifChoisi" class="field-hint">{{ motifChoisi.aide }}</span>
          </div>
          <div class="field">
            <label>
              Quantite reellement presente
              <span v-if="produitAjuste" class="muted">({{ produitAjuste.unite_stock }})</span>
            </label>
            <!-- On demande la quantite COMPTEE, pas un ecart : c'est ainsi qu'on
                 travaille en rayon, et cela evite une soustraction de tete qui
                 est justement la source d'erreur qu'on veut corriger. -->
            <input v-model="ajustement.quantite_reelle" type="number" min="0" step="0.01" required />
          </div>
        </div>

        <div class="field">
          <label>Note <span class="muted">(optionnel)</span></label>
          <input v-model="ajustement.note" type="text" maxlength="300" placeholder="Ex. deux flacons casses a la livraison" />
        </div>

        <div v-if="apercuAjustement" class="alert" :class="apercuAjustement.ecart === 0 ? 'alert-info' : (apercuAjustement.ecart < 0 ? 'alert-warning' : 'alert-info')">
          <Icon :name="apercuAjustement.ecart === 0 ? 'check' : 'warning'" :size="16" />
          <span v-if="apercuAjustement.ecart === 0">
            Le stock compte correspond au stock enregistre. Aucun mouvement ne sera cree.
          </span>
          <span v-else>
            Le stock passe de <strong>{{ formatQuantite(apercuAjustement.actuel) }}</strong>
            a <strong>{{ formatQuantite(apercuAjustement.cible) }} {{ apercuAjustement.unite }}</strong>,
            soit <strong>{{ apercuAjustement.ecart > 0 ? '+' : '' }}{{ formatQuantite(apercuAjustement.ecart) }}</strong>.
            <template v-if="apercuAjustement.ecart < 0">
              Valeur de la perte : <strong>{{ formatMontant(apercuAjustement.valeur) }}</strong>.
            </template>
          </span>
        </div>

        <p v-if="ajustementErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ ajustementErreur }}</span>
        </p>
      </form>

      <template #footer>
        <button type="button" @click="ajustementVisible = false">Annuler</button>
        <button type="submit" form="form-ajustement" class="primary" :disabled="ajustementSoumission">
          <span v-if="ajustementSoumission" class="spinner" />
          Enregistrer l'ajustement
        </button>
      </template>
    </Modal>

    <!-- ============ Modale entree de stock ============ -->
    <Modal v-if="entreeVisible" title="Entree de stock" @close="entreeVisible = false">
      <form id="form-entree" @submit.prevent="soumettreEntree">
        <div class="field">
          <label>Produit</label>
          <select v-model="entree.produit_id" required>
            <option value="" disabled>Choisir un produit</option>
            <option v-for="p in produits" :key="p.id" :value="p.id">
              {{ p.nom }} — {{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }} en stock
            </option>
          </select>
        </div>

        <div class="field-row">
          <div class="field">
            <label>
              Quantite achetee
              <span v-if="produitEntree" class="muted">({{ produitEntree.unite_achat || produitEntree.unite_stock }})</span>
            </label>
            <input v-model="entree.quantite_achat" type="number" min="0.01" step="0.01" required />
          </div>
          <div class="field">
            <label>Cout d'achat total</label>
            <input v-model="entree.cout_achat_total" type="number" min="0" step="0.01" required />
            <span class="field-hint">Prix paye pour tout le lot</span>
          </div>
        </div>

        <div v-if="modules.fournisseurs" class="field">
          <label>Fournisseur <span class="muted">(optionnel)</span></label>
          <select v-model="entree.fournisseur_id">
            <option value="">Aucun</option>
            <option v-for="f in fournisseurs" :key="f.id" :value="f.id">{{ f.nom }}</option>
          </select>
        </div>

        <div v-if="apercuEntree" class="alert alert-info">
          <Icon name="info" :size="16" />
          <span>
            Ajoute <strong>{{ formatQuantite(apercuEntree.quantiteRef) }} {{ apercuEntree.uniteRef }}</strong>
            au stock, a <strong>{{ formatMontant(apercuEntree.coutUnitaire) }}</strong> l'unite.
            Nouveau stock : <strong>{{ formatQuantite(apercuEntree.nouveauStock) }} {{ apercuEntree.uniteRef }}</strong>.
          </span>
        </div>

        <p v-if="entreeErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ entreeErreur }}</span>
        </p>
      </form>

      <template #footer>
        <button type="button" @click="entreeVisible = false">Annuler</button>
        <button type="submit" form="form-entree" class="primary" :disabled="entreeSoumission">
          <span v-if="entreeSoumission" class="spinner" />
          Enregistrer l'entree
        </button>
      </template>
    </Modal>
  </div>
</template>
