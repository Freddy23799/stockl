<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../api/client'
import { formatDate, formatMontant, formatQuantite } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import BoutonExport from '../components/ui/BoutonExport.vue'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import Pagination from '../components/ui/Pagination.vue'
import Icon from '../components/ui/Icon.vue'

const operations = ref([])
const utilisateurs = ref([])
const loading = ref(true)
const erreur = ref('')

const filtres = reactive({ type_operation: '', utilisateur_id: '', from: '', to: '' })
const page = ref(1)
const pageSize = 20
const total = ref(0)

// Le journal stocke des identifiants techniques ; l'ecran doit parler francais.
// Chaque entree : libelle lisible, tonalite de badge, icone de famille.
const OPERATIONS = {
  produit_creation: { libelle: 'Produit cree', ton: 'success', icone: 'package' },
  produit_modification: { libelle: 'Produit modifie', ton: 'warning', icone: 'edit' },
  produit_changement_prix: { libelle: 'Prix de vente change', ton: 'warning', icone: 'tag' },
  produit_desactivation: { libelle: 'Produit archive', ton: 'danger', icone: 'inbox' },
  vendeuse_creation: { libelle: 'Vendeuse creee', ton: 'success', icone: 'userPlus' },
  vendeuse_activation: { libelle: 'Vendeuse reactivee', ton: 'success', icone: 'toggle' },
  vendeuse_desactivation: { libelle: 'Vendeuse desactivee', ton: 'danger', icone: 'toggle' },
  utilisateur_creation: { libelle: 'Utilisateur cree', ton: 'success', icone: 'userPlus' },
  utilisateur_desactivation: { libelle: 'Utilisateur desactive', ton: 'danger', icone: 'toggle' },
  utilisateur_changement_mot_de_passe: { libelle: 'Mot de passe change', ton: 'warning', icone: 'key' },
  admin_initial_cree: { libelle: 'Compte administrateur initial', ton: 'info', icone: 'shield' },
  vente_creation: { libelle: 'Vente enregistree', ton: 'success', icone: 'cart' },
  entree_stock: { libelle: 'Entree de stock', ton: 'success', icone: 'boxIn' },
  depense_creation: { libelle: 'Depense enregistree', ton: 'success', icone: 'wallet' },
  fournisseur_creation: { libelle: 'Fournisseur cree', ton: 'success', icone: 'truck' },
  fournisseur_activation: { libelle: 'Fournisseur reactive', ton: 'success', icone: 'toggle' },
  fournisseur_desactivation: { libelle: 'Fournisseur desactive', ton: 'danger', icone: 'toggle' },
  parametres_modification: { libelle: 'Parametres modifies', ton: 'warning', icone: 'settings' },
  parametres_logo_modifie: { libelle: 'Logo modifie', ton: 'warning', icone: 'image' },
}

const typesConnus = Object.keys(OPERATIONS)

// Un type inconnu (ajoute cote serveur apres ce build) reste lisible : on deduit
// la famille du suffixe plutot que d'afficher un badge muet.
function decrire(type) {
  const connu = OPERATIONS[type]
  if (connu) return connu
  const t = String(type || '')
  if (/desactivation|suppression/.test(t)) return { libelle: t, ton: 'danger', icone: 'trash' }
  if (/creation|activation|entree/.test(t)) return { libelle: t, ton: 'success', icone: 'check' }
  if (/modification|changement/.test(t)) return { libelle: t, ton: 'warning', icone: 'edit' }
  return { libelle: t, ton: '', icone: 'info' }
}

/* --- Resume des details -------------------------------------------------- */

// Les champs qui racontent l'operation, dans l'ordre ou on veut les lire.
const CHAMPS_PARLANTS = [
  'nom', 'produit_nom', 'libelle', 'motif', 'categorie', 'code',
  'quantite', 'montant', 'montant_total', 'nouveau_prix', 'ancien_prix',
  'vendeuse_nom', 'fournisseur_nom', 'utilisateur_nom', 'reference',
]

function etiquetteChamp(cle) {
  return String(cle).replace(/_/g, ' ')
}

function valeurLisible(cle, valeur) {
  if (valeur === null || valeur === undefined) return '-'
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non'
  if (typeof valeur === 'object') return Array.isArray(valeur) ? `${valeur.length} element(s)` : '…'
  if (typeof valeur === 'number') {
    if (/prix|montant|cout|total/.test(cle)) return formatMontant(valeur)
    if (/quantite|nombre/.test(cle)) return formatQuantite(valeur)
    return String(valeur)
  }
  const texte = String(valeur)
  return texte.length > 42 ? `${texte.slice(0, 42)}…` : texte
}

function resumeDetails(details) {
  if (!details || typeof details !== 'object') return []
  const cles = Object.keys(details)
  const prioritaires = CHAMPS_PARLANTS.filter((c) => cles.includes(c))
  const retenues = [...prioritaires, ...cles.filter((c) => !prioritaires.includes(c))].slice(0, 3)
  return retenues.map((c) => ({ cle: c, etiquette: etiquetteChamp(c), valeur: valeurLisible(c, details[c]) }))
}

/* --- Recherche libre cote client ---------------------------------------- */

const recherche = ref('')

const operationsAffichees = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  if (!q) return operations.value
  return operations.value.filter((op) => {
    const morceaux = [
      op.type_operation,
      decrire(op.type_operation).libelle,
      op.utilisateur_nom || '',
      JSON.stringify(op.details || {}),
    ]
    return morceaux.join(' ').toLowerCase().includes(q)
  })
})

const filtresActifs = computed(() =>
  Boolean(filtres.type_operation || filtres.utilisateur_id || filtres.from || filtres.to)
)

/* --- Detail complet ------------------------------------------------------ */

const opDetail = ref(null)

const jsonDetail = computed(() =>
  opDetail.value ? JSON.stringify(opDetail.value.details ?? {}, null, 2) : ''
)

/* --- Chargement ---------------------------------------------------------- */

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const params = { page: page.value, pageSize }
    if (filtres.type_operation) params.type_operation = filtres.type_operation
    if (filtres.utilisateur_id) params.utilisateur_id = filtres.utilisateur_id
    if (filtres.from) params.from = filtres.from
    if (filtres.to) params.to = filtres.to
    const { data } = await api.get('/historique', { params })
    operations.value = data.data
    total.value = data.total
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

function filtrer() {
  page.value = 1
  charger()
}

function reinitialiser() {
  Object.assign(filtres, { type_operation: '', utilisateur_id: '', from: '', to: '' })
  recherche.value = ''
  filtrer()
}

function changerPage(nouvellePage) {
  page.value = nouvellePage
  charger()
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
    <PageHeader
      title="Historique"
      subtitle="Journal d'audit : qui a fait quoi, et quand. Chaque operation sensible y laisse une trace non modifiable."
    >
      <template #actions>
        <BoutonExport
          chemin="/exports/historique.pdf"
          :params="filtres"
          libelle="Journal d'audit"
          fichier="journal-audit"
        />
      </template>
    </PageHeader>

    <div class="card">
      <div class="card-head">
        <div class="toolbar flex-1">
          <div class="field" style="min-width: 200px">
            <label>Type d'operation</label>
            <select v-model="filtres.type_operation" @change="filtrer">
              <option value="">Tous les types</option>
              <option v-for="t in typesConnus" :key="t" :value="t">{{ OPERATIONS[t].libelle }}</option>
            </select>
          </div>
          <div class="field" style="min-width: 170px">
            <label>Utilisateur</label>
            <select v-model="filtres.utilisateur_id" @change="filtrer">
              <option value="">Tous</option>
              <option v-for="u in utilisateurs" :key="u.id" :value="u.id">{{ u.nom }}</option>
            </select>
          </div>
          <div class="field">
            <label>Du</label>
            <input v-model="filtres.from" type="date" />
          </div>
          <div class="field">
            <label>Au</label>
            <input v-model="filtres.to" type="date" />
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button type="button" @click="filtrer"><Icon name="filter" :size="15" /> Filtrer</button>
          </div>
          <div v-if="filtresActifs" class="field">
            <label>&nbsp;</label>
            <button type="button" class="btn-ghost" @click="reinitialiser">Reinitialiser</button>
          </div>
        </div>
      </div>

      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input v-model="recherche" type="search" placeholder="Rechercher dans cette page..." />
        </div>
        <span class="small muted">{{ operationsAffichees.length }} sur {{ operations.length }} ligne(s) chargee(s)</span>
      </div>

      <p v-if="erreur" class="alert alert-danger" style="margin: 18px">
        <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
      </p>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="8" :cols="5" />

        <EmptyState
          v-else-if="!operationsAffichees.length && recherche"
          icon="search"
          title="Aucun resultat"
          :desc="`Aucune operation chargee ne correspond a « ${recherche} ».`"
        >
          <button type="button" @click="recherche = ''">Effacer la recherche</button>
        </EmptyState>

        <EmptyState
          v-else-if="!operations.length && filtresActifs"
          icon="filter"
          title="Aucune operation"
          desc="Aucune trace ne correspond aux filtres choisis."
        >
          <button type="button" @click="reinitialiser">Reinitialiser les filtres</button>
        </EmptyState>

        <EmptyState
          v-else-if="!operations.length"
          icon="history"
          title="Journal vide"
          desc="Les operations apparaitront ici des la premiere action enregistree."
        />

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th style="width: 160px">Date</th>
                <th>Operation</th>
                <th>Utilisateur</th>
                <th class="hide-sm">Details</th>
                <th class="td-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="op in operationsAffichees" :key="op.id">
                <td data-label="Date" class="small muted nowrap">{{ formatDate(op.date) }}</td>
                <td data-label="Operation" class="td-titre">
                  <span class="badge" :class="decrire(op.type_operation).ton">
                    <Icon :name="decrire(op.type_operation).icone" :size="13" />
                    {{ decrire(op.type_operation).libelle }}
                  </span>
                  <div class="small muted mono mt-2 hide-sm">{{ op.type_operation }}</div>
                </td>
                <td data-label="Utilisateur" class="td-strong">{{ op.utilisateur_nom || '-' }}</td>
                <td data-label="Details" class="hide-sm">
                  <div v-if="resumeDetails(op.details).length" class="row wrap" style="gap: 6px">
                    <span v-for="d in resumeDetails(op.details)" :key="d.cle" class="badge">
                      <span class="muted">{{ d.etiquette }}</span> {{ d.valeur }}
                    </span>
                  </div>
                  <span v-else class="small muted">Aucun detail</span>
                </td>
                <td data-label="" class="td-actions">
                  <button
                    type="button"
                    class="btn-sm btn-ghost"
                    title="Voir les details bruts"
                    @click="opDetail = op"
                  >
                    <Icon name="eye" :size="15" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card-foot">
        <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="changerPage" />
      </div>
    </div>

    <Modal v-if="opDetail" :title="decrire(opDetail.type_operation).libelle" size="lg" @close="opDetail = null">
      <div class="stack">
        <div class="row wrap">
          <span class="badge" :class="decrire(opDetail.type_operation).ton">
            <Icon :name="decrire(opDetail.type_operation).icone" :size="13" />
            {{ decrire(opDetail.type_operation).libelle }}
          </span>
          <span class="badge mono">{{ opDetail.type_operation }}</span>
          <span class="small muted">{{ formatDate(opDetail.date) }}</span>
          <span class="small muted">par {{ opDetail.utilisateur_nom || 'systeme' }}</span>
        </div>
        <pre class="json-brut">{{ jsonDetail }}</pre>
      </div>
      <template #footer>
        <button type="button" @click="opDetail = null">Fermer</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.json-brut {
  margin: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  color: var(--text-h);
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
}
</style>
