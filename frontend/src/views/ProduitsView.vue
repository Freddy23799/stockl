<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api, { assetUrl } from '../api/client'
import { useToastStore } from '../stores/toasts'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import Icon from '../components/ui/Icon.vue'

const toasts = useToastStore()

const tousLesProduits = ref([])
const loading = ref(true)
const erreur = ref('')

const ongletActif = ref('actifs')
const recherche = ref('')
const triColonne = ref('nom')
const triSens = ref('asc')

const onglets = computed(() => [
  { id: 'actifs', label: 'Catalogue', icon: 'package', count: actifs.value.length },
  { id: 'alerte', label: 'En alerte', icon: 'warning', count: enAlerte.value.length },
  { id: 'inactifs', label: 'Archives', icon: 'inbox', count: inactifs.value.length },
])

const actifs = computed(() => tousLesProduits.value.filter((p) => p.actif))
const inactifs = computed(() => tousLesProduits.value.filter((p) => !p.actif))
const enAlerte = computed(() =>
  actifs.value.filter((p) => Number(p.quantite_stock) <= Number(p.seuil_alerte))
)

// Valeur immobilisee : ce que le stock actuel a coute, pas ce qu'il rapportera.
const valeurStock = computed(() =>
  actifs.value.reduce((s, p) => s + Number(p.quantite_stock) * Number(p.cout_moyen_pondere), 0)
)

const listeCourante = computed(() => {
  if (ongletActif.value === 'inactifs') return inactifs.value
  if (ongletActif.value === 'alerte') return enAlerte.value
  return actifs.value
})

const produitsAffiches = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  const liste = q
    ? listeCourante.value.filter((p) => p.nom.toLowerCase().includes(q))
    : [...listeCourante.value]

  const sens = triSens.value === 'asc' ? 1 : -1
  return liste.sort((a, b) => {
    const col = triColonne.value
    const va = col === 'nom' ? a.nom.toLowerCase() : Number(a[col])
    const vb = col === 'nom' ? b.nom.toLowerCase() : Number(b[col])
    if (va < vb) return -1 * sens
    if (va > vb) return 1 * sens
    return 0
  })
})

function trier(colonne) {
  if (triColonne.value === colonne) {
    triSens.value = triSens.value === 'asc' ? 'desc' : 'asc'
  } else {
    triColonne.value = colonne
    triSens.value = 'asc'
  }
}

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get('/produits', { params: { includeInactifs: true } })
    tousLesProduits.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

onMounted(charger)

/* --- Creation / edition ------------------------------------------------- */

const formVisible = ref(false)
const modeEdition = ref(false)
const soumission = ref(false)
const formErreur = ref('')
const form = reactive({
  id: null, nom: '', prix_vente: '', unite_stock: '', unite_achat: '', facteur_conversion: 1, seuil_alerte: 0,
})

// Montre concretement ce que le facteur de conversion signifie, la ou c'est
// le reglage le plus mal compris de la fiche produit.
const apercuConversion = computed(() => {
  const f = Number(form.facteur_conversion)
  if (!form.unite_achat || !form.unite_stock || !Number.isFinite(f) || f <= 0) return ''
  return `1 ${form.unite_achat} = ${formatQuantite(f)} ${form.unite_stock}`
})

function ouvrirCreation() {
  modeEdition.value = false
  formErreur.value = ''
  Object.assign(form, { id: null, nom: '', prix_vente: '', unite_stock: '', unite_achat: '', facteur_conversion: 1, seuil_alerte: 0 })
  formVisible.value = true
}

function ouvrirEdition(p) {
  modeEdition.value = true
  formErreur.value = ''
  Object.assign(form, {
    id: p.id, nom: p.nom, prix_vente: p.prix_vente, unite_stock: p.unite_stock,
    unite_achat: p.unite_achat || '', facteur_conversion: p.facteur_conversion, seuil_alerte: p.seuil_alerte,
  })
  formVisible.value = true
}

async function soumettreForm() {
  soumission.value = true
  formErreur.value = ''
  try {
    const payload = {
      nom: form.nom.trim(),
      prix_vente: Number(form.prix_vente),
      unite_stock: form.unite_stock.trim(),
      unite_achat: form.unite_achat.trim() || null,
      facteur_conversion: Number(form.facteur_conversion) || 1,
      seuil_alerte: Number(form.seuil_alerte) || 0,
    }
    if (modeEdition.value) {
      await api.put(`/produits/${form.id}`, payload)
      toasts.succes(`"${payload.nom}" mis a jour`)
    } else {
      await api.post('/produits', payload)
      toasts.succes(`"${payload.nom}" ajoute au catalogue`)
    }
    formVisible.value = false
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement'
  } finally {
    soumission.value = false
  }
}

/* --- Desactivation ------------------------------------------------------ */

const aDesactiver = ref(null)
const desactivationEnCours = ref(false)

async function confirmerDesactivation() {
  desactivationEnCours.value = true
  try {
    await api.patch(`/produits/${aDesactiver.value.id}/desactiver`)
    toasts.succes(`"${aDesactiver.value.nom}" archive`)
    aDesactiver.value = null
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur lors de l\'archivage')
  } finally {
    desactivationEnCours.value = false
  }
}

/* --- Historique des prix ------------------------------------------------ */

const historiqueVisible = ref(false)
const historiqueProduit = ref(null)
const historiquePrix = ref([])
const historiqueChargement = ref(false)

async function ouvrirHistorique(p) {
  historiqueProduit.value = p
  historiqueVisible.value = true
  historiqueChargement.value = true
  historiquePrix.value = []
  try {
    const { data } = await api.get(`/produits/${p.id}/historique-prix`)
    historiquePrix.value = data
  } finally {
    historiqueChargement.value = false
  }
}

/* --- Photo -------------------------------------------------------------- */

const photoVisible = ref(false)
const photoProduit = ref(null)
const photoFichier = ref(null)
const photoApercu = ref('')
const photoEnvoi = ref(false)
const photoErreur = ref('')

function ouvrirPhoto(p) {
  photoProduit.value = p
  photoFichier.value = null
  photoApercu.value = ''
  photoErreur.value = ''
  photoVisible.value = true
}

function surChoixFichier(e) {
  const f = e.target.files[0] || null
  photoFichier.value = f
  // Apercu local avant envoi : on voit ce qu'on televerse sans aller-retour serveur.
  photoApercu.value = f ? URL.createObjectURL(f) : ''
}

async function envoyerPhoto() {
  if (!photoFichier.value) return
  photoEnvoi.value = true
  photoErreur.value = ''
  try {
    const formData = new FormData()
    formData.append('photo', photoFichier.value)
    await api.post(`/produits/${photoProduit.value.id}/photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    photoVisible.value = false
    toasts.succes('Photo mise a jour')
    await charger()
  } catch (err) {
    photoErreur.value = err.response?.data?.message || 'Erreur lors de l\'envoi de la photo'
  } finally {
    photoEnvoi.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="Produits" subtitle="Le catalogue est la reference de tout le systeme : stock, ventes et rapports en dependent.">
      <template #actions>
        <button type="button" class="primary" @click="ouvrirCreation">
          <Icon name="plus" :size="15" /> Nouveau produit
        </button>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div class="grid grid-stats mb-4">
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon is-accent"><Icon name="package" :size="15" /></span>
          <span class="stat-label">Produits actifs</span>
        </div>
        <div class="stat-value">{{ actifs.length }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon" :class="enAlerte.length ? 'is-danger' : 'is-success'">
            <Icon name="warning" :size="15" />
          </span>
          <span class="stat-label">En alerte</span>
        </div>
        <div class="stat-value">{{ enAlerte.length }}</div>
      </div>
      <div class="stat">
        <div class="stat-top">
          <span class="stat-icon"><Icon name="wallet" :size="15" /></span>
          <span class="stat-label">Valeur du stock</span>
        </div>
        <div class="stat-value">{{ formatMontant(valeurStock) }}</div>
        <div class="stat-foot">Au cout moyen pondere</div>
      </div>
    </div>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <div class="card">
      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input v-model="recherche" type="search" placeholder="Rechercher un produit..." />
        </div>
        <span class="small muted">{{ produitsAffiches.length }} affiche(s)</span>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="6" :cols="6" />

        <EmptyState
          v-else-if="!produitsAffiches.length && recherche"
          icon="search"
          title="Aucun resultat"
          :desc="`Aucun produit ne correspond a « ${recherche} ».`"
        >
          <button type="button" @click="recherche = ''">Effacer la recherche</button>
        </EmptyState>

        <EmptyState
          v-else-if="!produitsAffiches.length && ongletActif === 'actifs'"
          icon="package"
          title="Aucun produit"
          desc="Commencez par creer vos produits : tout le reste du systeme en depend."
        >
          <button type="button" class="primary" @click="ouvrirCreation">
            <Icon name="plus" :size="15" /> Creer le premier produit
          </button>
        </EmptyState>

        <EmptyState
          v-else-if="!produitsAffiches.length && ongletActif === 'alerte'"
          icon="check"
          title="Aucune alerte"
          desc="Tous les produits sont au-dessus de leur seuil."
        />

        <EmptyState
          v-else-if="!produitsAffiches.length"
          icon="inbox"
          title="Aucun produit archive"
          desc="Les produits archives restent consultables ici sans polluer le catalogue."
        />

        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 46px"></th>
                <th class="sortable" :class="{ 'is-sorted': triColonne === 'nom' }" @click="trier('nom')">
                  Produit <span class="sort-arrow">{{ triColonne === 'nom' && triSens === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="sortable td-num" :class="{ 'is-sorted': triColonne === 'prix_vente' }" @click="trier('prix_vente')">
                  Prix <span class="sort-arrow">{{ triColonne === 'prix_vente' && triSens === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="sortable td-num" :class="{ 'is-sorted': triColonne === 'quantite_stock' }" @click="trier('quantite_stock')">
                  Stock <span class="sort-arrow">{{ triColonne === 'quantite_stock' && triSens === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th>Conditionnement</th>
                <th class="td-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in produitsAffiches" :key="p.id">
                <td>
                  <img v-if="p.photo" :src="assetUrl(p.photo)" class="thumb" alt="" />
                  <div v-else class="thumb"><Icon name="image" :size="15" /></div>
                </td>
                <td>
                  <div class="td-strong">{{ p.nom }}</div>
                  <span v-if="!p.actif" class="badge mt-2">Archive</span>
                </td>
                <td class="td-num td-strong tnum">{{ formatMontant(p.prix_vente) }}</td>
                <td class="td-num">
                  <span
                    class="badge"
                    :class="Number(p.quantite_stock) <= Number(p.seuil_alerte) ? 'danger' : 'success'"
                  >
                    {{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }}
                  </span>
                  <div class="small muted mt-2 tnum">seuil {{ formatQuantite(p.seuil_alerte) }}</div>
                </td>
                <td class="small muted">
                  <template v-if="p.unite_achat">
                    1 {{ p.unite_achat }} = {{ formatQuantite(p.facteur_conversion) }} {{ p.unite_stock }}
                  </template>
                  <template v-else>Vendu a l'unite</template>
                </td>
                <td class="td-actions">
                  <button type="button" class="btn-sm btn-ghost" title="Modifier" @click="ouvrirEdition(p)">
                    <Icon name="edit" :size="15" />
                  </button>
                  <button type="button" class="btn-sm btn-ghost" title="Photo" @click="ouvrirPhoto(p)">
                    <Icon name="image" :size="15" />
                  </button>
                  <button type="button" class="btn-sm btn-ghost" title="Historique des prix" @click="ouvrirHistorique(p)">
                    <Icon name="history" :size="15" />
                  </button>
                  <button
                    v-if="p.actif"
                    type="button"
                    class="btn-sm btn-ghost"
                    title="Archiver"
                    style="color: var(--danger)"
                    @click="aDesactiver = p"
                  >
                    <Icon name="trash" :size="15" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Creation / edition -->
    <Modal
      v-if="formVisible"
      :title="modeEdition ? 'Modifier le produit' : 'Nouveau produit'"
      @close="formVisible = false"
    >
      <form id="form-produit" @submit.prevent="soumettreForm">
        <div class="field">
          <label>Nom du produit</label>
          <input v-model="form.nom" placeholder="Eau de parfum Rose 50 mL" required />
        </div>

        <div class="field-row">
          <div class="field">
            <label>Prix de vente</label>
            <input v-model="form.prix_vente" type="number" min="0" step="0.01" required />
          </div>
          <div class="field">
            <label>Seuil d'alerte</label>
            <input v-model="form.seuil_alerte" type="number" min="0" step="0.01" />
            <span class="field-hint">Alerte quand le stock descend a ce niveau</span>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Unite de stock</label>
            <input v-model="form.unite_stock" placeholder="piece, mL, g..." required />
            <span class="field-hint">L'unite dans laquelle vous comptez</span>
          </div>
          <div class="field">
            <label>Unite d'achat <span class="muted">(optionnel)</span></label>
            <input v-model="form.unite_achat" placeholder="carton, bidon, kg..." />
            <span class="field-hint">Si vous achetez en gros</span>
          </div>
        </div>

        <div v-if="form.unite_achat" class="field">
          <label>Facteur de conversion</label>
          <input v-model="form.facteur_conversion" type="number" min="0.0001" step="0.0001" />
          <span v-if="apercuConversion" class="field-hint strong">{{ apercuConversion }}</span>
          <span v-else class="field-hint">Combien d'unites de stock dans une unite d'achat</span>
        </div>

        <p v-if="formErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ formErreur }}</span>
        </p>
      </form>

      <template #footer>
        <button type="button" @click="formVisible = false">Annuler</button>
        <button type="submit" form="form-produit" class="primary" :disabled="soumission">
          <span v-if="soumission" class="spinner" />
          {{ modeEdition ? 'Enregistrer' : 'Creer le produit' }}
        </button>
      </template>
    </Modal>

    <!-- Historique des prix -->
    <Modal
      v-if="historiqueVisible"
      :title="`Historique des prix — ${historiqueProduit?.nom}`"
      @close="historiqueVisible = false"
    >
      <TableSkeleton v-if="historiqueChargement" :rows="3" :cols="3" />
      <EmptyState
        v-else-if="!historiquePrix.length"
        icon="tag"
        title="Aucun changement de prix"
        desc="Le prix de vente n'a jamais ete modifie depuis la creation du produit."
      />
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th class="td-num">Ancien</th><th class="td-num">Nouveau</th><th class="td-num">Ecart</th></tr>
          </thead>
          <tbody>
            <tr v-for="h in historiquePrix" :key="h.id">
              <td class="small muted nowrap">{{ formatDate(h.date) }}</td>
              <td class="td-num tnum muted">{{ formatMontant(h.ancien_prix) }}</td>
              <td class="td-num tnum td-strong">{{ formatMontant(h.nouveau_prix) }}</td>
              <td class="td-num">
                <span class="badge" :class="Number(h.nouveau_prix) >= Number(h.ancien_prix) ? 'success' : 'danger'">
                  {{ Number(h.nouveau_prix) >= Number(h.ancien_prix) ? '+' : '' }}{{ formatMontant(Number(h.nouveau_prix) - Number(h.ancien_prix)) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>

    <!-- Photo -->
    <Modal v-if="photoVisible" :title="`Photo — ${photoProduit?.nom}`" @close="photoVisible = false">
      <form id="form-photo" @submit.prevent="envoyerPhoto">
        <div class="row" style="gap: 14px; align-items: flex-start">
          <img v-if="photoApercu" :src="photoApercu" class="thumb thumb-lg" alt="" />
          <img v-else-if="photoProduit?.photo" :src="assetUrl(photoProduit.photo)" class="thumb thumb-lg" alt="" />
          <div v-else class="thumb thumb-lg"><Icon name="image" :size="20" /></div>
          <div class="field flex-1">
            <label>Choisir une image</label>
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="surChoixFichier" />
            <span class="field-hint">JPG, PNG ou WebP — 5 Mo maximum</span>
          </div>
        </div>
        <p v-if="photoErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ photoErreur }}</span>
        </p>
      </form>
      <template #footer>
        <button type="button" @click="photoVisible = false">Annuler</button>
        <button type="submit" form="form-photo" class="primary" :disabled="!photoFichier || photoEnvoi">
          <span v-if="photoEnvoi" class="spinner" />
          Envoyer
        </button>
      </template>
    </Modal>

    <ConfirmDialog
      v-if="aDesactiver"
      title="Archiver ce produit ?"
      :message="`« ${aDesactiver.nom} » disparaitra du catalogue et ne pourra plus etre vendu. Son historique de ventes et de stock reste intact.`"
      confirm-label="Archiver"
      :busy="desactivationEnCours"
      @confirm="confirmerDesactivation"
      @cancel="aDesactiver = null"
    />
  </div>
</template>
