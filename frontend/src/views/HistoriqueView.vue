<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../api/client'
import { formatDate } from '../utils/format'
import {
  OPERATIONS, decrire, changements, resumeLisible, consequence,
  partiesDetails, dateEnToutesLettres, tempsRelatif,
  aEtatAnterieur, valeursEnregistrees,
} from '../utils/audit'
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

const typesConnus = Object.keys(OPERATIONS)

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

/* --- Detail --------------------------------------------------------------- */

const opDetail = ref(null)
const donneesTechniquesOuvertes = ref(false)

function ouvrirDetail(op) {
  opDetail.value = op
  // Toujours replie a l'ouverture : le JSON est un outil de depannage, plus la
  // vue principale.
  donneesTechniquesOuvertes.value = false
}

const detailChangements = computed(() => (opDetail.value ? changements(opDetail.value.details) : []))
const detailComparaison = computed(() => (opDetail.value ? aEtatAnterieur(opDetail.value.details) : false))

// Une modification affiche son resume a cote du tableau avant/apres ; une
// creation n'a pas de tableau, donc on lui presente l'etat d'arrivee complet.
const detailValeurs = computed(() => {
  if (!opDetail.value) return []
  return detailComparaison.value
    ? resumeLisible(opDetail.value.details, 12)
    : valeursEnregistrees(opDetail.value.details)
})
const detailConsequence = computed(() => (opDetail.value ? consequence(opDetail.value) : ''))
const detailAncienneForme = computed(() =>
  opDetail.value ? partiesDetails(opDetail.value.details).ancienneForme : false
)

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
              <option v-for="u in utilisateurs" :key="u.id" :value="u.id">
                {{ [u.prenom, u.nom].filter(Boolean).join(' ') || u.nom_utilisateur }}
              </option>
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
                <th style="width: 165px">Date</th>
                <th>Operation</th>
                <th>Utilisateur</th>
                <th class="hide-sm">Details</th>
                <th class="td-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="op in operationsAffichees" :key="op.id" class="ligne-cliquable" @click="ouvrirDetail(op)">
                <td data-label="Date" class="small muted nowrap">
                  {{ formatDate(op.date) }}
                  <div class="small muted">{{ tempsRelatif(op.date) }}</div>
                </td>
                <td data-label="Operation" class="td-titre">
                  <span class="badge" :class="decrire(op.type_operation).ton">
                    <Icon :name="decrire(op.type_operation).icone" :size="13" />
                    {{ decrire(op.type_operation).libelle }}
                  </span>
                </td>
                <td data-label="Utilisateur">
                  <div class="td-strong">{{ op.utilisateur_nom || 'Systeme' }}</div>
                  <div v-if="op.utilisateur_identifiant" class="small muted mono">{{ op.utilisateur_identifiant }}</div>
                </td>
                <td data-label="Details" class="hide-sm">
                  <div v-if="resumeLisible(op.details).length" class="row wrap" style="gap: 6px">
                    <span v-for="d in resumeLisible(op.details)" :key="d.cle" class="badge">
                      <span class="muted">{{ d.label }}</span> {{ d.valeur }}
                    </span>
                  </div>
                  <span v-else class="small muted">Aucun detail</span>
                </td>
                <td data-label="" class="td-actions">
                  <button type="button" class="btn-sm btn-ghost" title="Voir le detail" @click.stop="ouvrirDetail(op)">
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

    <!-- ============ Detail d'une operation ============ -->
    <Modal v-if="opDetail" :title="decrire(opDetail.type_operation).libelle" size="lg" @close="opDetail = null">
      <div class="stack" style="gap: 18px">
        <!-- Qui, quand, sur quoi -->
        <div class="fiche-audit">
          <div class="fiche-ligne">
            <span class="fiche-cle">Operation</span>
            <span class="fiche-valeur">
              <span class="badge" :class="decrire(opDetail.type_operation).ton">
                <Icon :name="decrire(opDetail.type_operation).icone" :size="13" />
                {{ decrire(opDetail.type_operation).libelle }}
              </span>
            </span>
          </div>
          <div class="fiche-ligne">
            <span class="fiche-cle">Realisee par</span>
            <span class="fiche-valeur">
              <strong>{{ opDetail.utilisateur_nom || 'Systeme' }}</strong>
              <template v-if="opDetail.utilisateur_identifiant">
                <span class="mono muted small"> ({{ opDetail.utilisateur_identifiant }})</span>
              </template>
              <span v-if="opDetail.utilisateur_actif === false" class="badge danger" style="margin-left: 6px">
                compte bloque
              </span>
            </span>
          </div>
          <div class="fiche-ligne">
            <span class="fiche-cle">Date et heure</span>
            <span class="fiche-valeur">
              {{ dateEnToutesLettres(opDetail.date) }}
              <span class="muted small"> — {{ tempsRelatif(opDetail.date) }}</span>
            </span>
          </div>
          <div v-if="opDetail.entite_id" class="fiche-ligne">
            <span class="fiche-cle">Element concerne</span>
            <span class="fiche-valeur mono">n° {{ opDetail.entite_id }}</span>
          </div>
        </div>

        <!-- Ce que l'operation implique -->
        <div v-if="detailConsequence" class="alert alert-info consequence">
          <Icon name="info" :size="16" />
          <span>{{ detailConsequence }}</span>
        </div>

        <!-- Ce qui a change : uniquement quand il y a un etat anterieur.
             Une creation n'a rien "avant", et une colonne vide en face de
             chaque champ laisserait croire a un effacement. -->
        <section v-if="detailComparaison && detailChangements.length">
          <h3 class="titre-section">Ce qui a change</h3>
          <div class="table-wrap">
            <table class="table-cards">
              <thead>
                <tr>
                  <th>Champ</th>
                  <th>Avant</th>
                  <th>Apres</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in detailChangements" :key="c.cle">
                  <td data-label="Champ" class="td-titre td-strong">{{ c.label }}</td>
                  <td data-label="Avant" class="valeur-avant">{{ c.avant ?? '—' }}</td>
                  <td data-label="Apres" class="valeur-apres">{{ c.apres ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Informations enregistrees avec l'operation -->
        <section v-if="detailValeurs.length">
          <h3 class="titre-section">
            {{ detailComparaison ? 'Informations enregistrees' : 'Valeurs enregistrees' }}
          </h3>
          <div class="fiche-audit">
            <div v-for="d in detailValeurs" :key="d.cle" class="fiche-ligne">
              <span class="fiche-cle">{{ d.label }}</span>
              <span class="fiche-valeur">{{ d.valeur }}</span>
            </div>
          </div>
        </section>

        <!-- Les traces anterieures a la mise en place de l'avant/apres n'ont pas
             d'etat de depart : on le dit, plutot que d'afficher un tableau vide
             qui laisserait croire a une perte de donnees. -->
        <p v-if="detailAncienneForme && !detailChangements.length" class="small muted">
          Cette trace a ete enregistree avant que le journal ne conserve l'etat anterieur des
          fiches. Seules les informations ci-dessus ont ete relevees au moment de l'operation.
        </p>

        <p v-else-if="!detailChangements.length && !detailResume.length" class="small muted">
          Aucune information complementaire n'a ete enregistree pour cette operation.
        </p>

        <!-- Depannage -->
        <section>
          <button type="button" class="btn-sm btn-ghost" @click="donneesTechniquesOuvertes = !donneesTechniquesOuvertes">
            <Icon :name="donneesTechniquesOuvertes ? 'chevronDown' : 'chevronRight'" :size="14" />
            Donnees techniques
          </button>
          <div v-if="donneesTechniquesOuvertes" class="mt-3">
            <p class="small muted mb-2">
              Contenu brut de la trace, tel qu'il est enregistre. Utile pour un diagnostic.
              <span class="mono">{{ opDetail.type_operation }}</span>
            </p>
            <pre class="json-brut">{{ jsonDetail }}</pre>
          </div>
        </section>
      </div>

      <template #footer>
        <button type="button" @click="opDetail = null">Fermer</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.ligne-cliquable { cursor: pointer; }
.ligne-cliquable:hover { background: var(--bg-subtle); }

.titre-section {
  margin: 0 0 9px;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.fiche-audit {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
}
.fiche-ligne {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 9px 13px;
}
.fiche-ligne + .fiche-ligne { border-top: 1px solid var(--border); }
.fiche-cle {
  flex: none;
  width: 150px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.fiche-valeur { flex: 1; min-width: 0; font-size: 13px; color: var(--text-h); overflow-wrap: anywhere; }

/* L'ancienne valeur est barree et effacee, la nouvelle mise en avant : la
   direction du changement se lit sans avoir a comparer deux colonnes. */
.valeur-avant { color: var(--text-muted); text-decoration: line-through; }
.valeur-apres { font-weight: 600; color: var(--text-h); }

.consequence { align-items: flex-start; }

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

/* En cartes, les libelles "Avant" et "Apres" portent le sens : le barre seul
   serait ambigu sans son entete de colonne. */
@media (max-width: 700px) {
  .fiche-ligne { flex-direction: column; gap: 2px; }
  .fiche-cle { width: auto; }
}
</style>
