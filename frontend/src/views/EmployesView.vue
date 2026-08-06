<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api, { assetUrl } from '../api/client'
import { useModulesStore } from '../stores/modules'
import { useToastStore } from '../stores/toasts'
import { formatMontant, formatDateCourt } from '../utils/format'
import { telechargerDocument, nommerDocument } from '../utils/telecharger'
import PageHeader from '../components/ui/PageHeader.vue'
import BoutonExport from '../components/ui/BoutonExport.vue'
import GestionFonctions from '../components/ui/GestionFonctions.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import StatCard from '../components/ui/StatCard.vue'
import Icon from '../components/ui/Icon.vue'

const router = useRouter()
const modules = useModulesStore()
const toasts = useToastStore()

const employes = ref([])
const fonctions = ref([])
const loading = ref(true)
const erreur = ref('')

const ongletActif = ref('actifs')
const recherche = ref('')
const fonctionFiltre = ref('')

const onglets = computed(() => [
  { id: 'actifs', label: 'En poste', icon: 'users', count: actifs.value.length },
  { id: 'archives', label: 'Archives', icon: 'inbox', count: archives.value.length },
])

const actifs = computed(() => employes.value.filter((e) => e.actif))
const archives = computed(() => employes.value.filter((e) => !e.actif))

const liste = computed(() => {
  const base = ongletActif.value === 'actifs' ? actifs.value : archives.value
  const q = recherche.value.trim().toLowerCase()
  return base.filter((e) => {
    if (fonctionFiltre.value && e.fonction_id !== Number(fonctionFiltre.value)) return false
    if (!q) return true
    // Nom, matricule, telephone et fonction : les quatre choses dont on dispose
    // quand on cherche quelqu'un, y compris un matricule lu sur un badge.
    return [e.prenom, e.nom, e.matricule, e.telephone, e.fonction]
      .filter(Boolean).join(' ').toLowerCase().includes(q)
  })
})

/* --- Selection pour l'impression des badges ------------------------------- */

// Les cartes plastifiees coutent cher : on doit pouvoir n'imprimer que celles
// dont on a besoin, plutot qu'une planche de neuf pour en remplacer une.
const selection = ref(new Set())

const toutSelectionne = computed(() =>
  liste.value.length > 0 && liste.value.every((e) => selection.value.has(e.id))
)

function basculerSelection(id) {
  const copie = new Set(selection.value)
  if (copie.has(id)) copie.delete(id)
  else copie.add(id)
  selection.value = copie
}

function basculerTout() {
  if (toutSelectionne.value) {
    // Ne deselectionne que ce qui est visible : un filtre actif ne doit pas
    // effacer une selection faite avant de filtrer.
    const copie = new Set(selection.value)
    liste.value.forEach((e) => copie.delete(e.id))
    selection.value = copie
  } else {
    const copie = new Set(selection.value)
    liste.value.forEach((e) => copie.add(e.id))
    selection.value = copie
  }
}

function viderSelection() {
  selection.value = new Set()
}

const idsSelection = computed(() => [...selection.value].join(','))

async function imprimerSelection() {
  const nombre = selection.value.size
  await telechargerDocument('/exports/badges.pdf', {
    params: { ids: idsSelection.value },
    libelle: nombre === 1 ? 'Badge employe' : `Badges (${nombre} employes)`,
    nomFichier: nommerDocument(nombre === 1 ? 'badge' : 'badges-employes'),
  })
}

/* --- Fonctions ------------------------------------------------------------ */

const fonctionsVisible = ref(false)

async function rechargerFonctions() {
  try {
    const { data } = await api.get('/employes/fonctions')
    fonctions.value = data
  } catch {
    // Non bloquant : la liste des fonctions reste celle du dernier chargement.
  }
}

// La masse salariale ne compte que les employes en poste : inclure les archives
// donnerait un total que l'on ne verse plus a personne.
const masseSalariale = computed(() =>
  actifs.value.reduce((s, e) => s + Number(e.salaire_actuel || 0), 0)
)

const sansSalaire = computed(() => actifs.value.filter((e) => !e.salaire_actuel).length)

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const [listeRes, fonctionsRes] = await Promise.all([
      api.get('/employes', { params: { inclure_inactifs: 'true' } }),
      api.get('/employes/fonctions'),
    ])
    employes.value = listeRes.data
    fonctions.value = fonctionsRes.data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

/* --- Creation ------------------------------------------------------------- */

const formVisible = ref(false)
const form = reactive({
  prenom: '', nom: '', fonction_id: '', salaire: '',
  telephone: '', email: '', date_embauche: new Date().toISOString().slice(0, 10),
  sexe: '', numero_cni: '', ville: '', type_contrat: '',
})
const formErreur = ref('')
const soumission = ref(false)

// Le matricule genere s'affiche une fois la creation faite : c'est ce qu'il faut
// communiquer a la personne, et il n'est pas devinable a l'avance.
const dernierCree = ref(null)

function ouvrirForm() {
  Object.assign(form, {
    prenom: '', nom: '', fonction_id: '', salaire: '',
    telephone: '', email: '', date_embauche: new Date().toISOString().slice(0, 10),
    sexe: '', numero_cni: '', ville: '', type_contrat: '',
  })
  formErreur.value = ''
  dernierCree.value = null
  formVisible.value = true
}

async function soumettre() {
  formErreur.value = ''
  soumission.value = true
  try {
    const { data } = await api.post('/employes', {
      ...form,
      salaire: Number(form.salaire),
      fonction_id: Number(form.fonction_id),
    })
    dernierCree.value = data
    await charger()
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur lors de la creation'
  } finally {
    soumission.value = false
  }
}

async function basculerArchive(employe) {
  try {
    const action = employe.actif ? 'archiver' : 'reactiver'
    await api.patch(`/employes/${employe.id}/${action}`)
    toasts.succes(employe.actif ? `${employe.prenom} ${employe.nom} archive(e)` : `${employe.prenom} ${employe.nom} reactive(e)`)
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  }
}

function ouvrirFiche(employe) {
  router.push({ name: 'employe-detail', params: { id: employe.id } })
}

onMounted(charger)
</script>

<template>
  <div>
    <PageHeader
      title="Employes"
      subtitle="Le dossier de chaque membre du personnel : identite, carriere, documents et remuneration."
    >
      <template #actions>
        <BoutonExport
          chemin="/exports/employes.pdf"
          :params="{ inclure_inactifs: ongletActif === 'archives' ? 'true' : '' }"
          libelle="Registre du personnel"
          fichier="registre-personnel"
          texte="Registre PDF"
        />
        <BoutonExport
          v-if="modules.badges && actifs.length"
          chemin="/exports/badges.pdf"
          libelle="Planche de badges"
          fichier="badges-employes"
          texte="Badges"
        />
        <button type="button" @click="fonctionsVisible = true">
          <Icon name="briefcase" :size="15" /> Fonctions
        </button>
        <button type="button" class="primary" @click="ouvrirForm">
          <Icon name="userPlus" :size="15" /> Nouvel employe
        </button>
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div class="grid grid-stats mb-4">
      <StatCard label="Employes en poste" :value="actifs.length" icon="users" tone="accent" />
      <StatCard
        label="Masse salariale mensuelle"
        :value="formatMontant(masseSalariale)"
        icon="wallet"
        hint="Somme des salaires en cours"
      />
      <StatCard
        label="Salaire moyen"
        :value="formatMontant(actifs.length ? masseSalariale / actifs.length : 0)"
        icon="trending"
      />
      <StatCard
        v-if="sansSalaire"
        label="Sans salaire defini"
        :value="sansSalaire"
        icon="warning"
        tone="danger"
        hint="Exclus des cycles de paie"
      />
    </div>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <div class="card">
      <div class="card-head">
        <div class="search">
          <Icon name="search" :size="15" />
          <input v-model="recherche" type="search" placeholder="Nom, matricule, telephone..." />
        </div>
        <div class="field" style="min-width: 170px; margin: 0">
          <select v-model="fonctionFiltre">
            <option value="">Toutes les fonctions</option>
            <option v-for="f in fonctions" :key="f.id" :value="f.id">
              {{ f.nom }} ({{ f.effectif }})
            </option>
          </select>
        </div>
        <span class="small muted">{{ liste.length }} employe(s)</span>
      </div>

      <div class="card-body card-body-flush">
        <TableSkeleton v-if="loading" :rows="6" :cols="5" />

        <EmptyState
          v-else-if="!liste.length && (recherche || fonctionFiltre)"
          icon="search"
          title="Aucun resultat"
          desc="Aucun employe ne correspond a cette recherche."
        >
          <button type="button" @click="recherche = ''; fonctionFiltre = ''">Effacer les filtres</button>
        </EmptyState>

        <EmptyState
          v-else-if="!liste.length && ongletActif === 'archives'"
          icon="inbox"
          title="Aucun employe archive"
          desc="Les employes qui quittent l'entreprise sont archives ici, avec tout leur historique."
        />

        <EmptyState
          v-else-if="!liste.length"
          icon="users"
          title="Aucun employe"
          desc="Creez la fiche de votre premier employe : matricule, salaire et badge sont generes automatiquement."
        >
          <button type="button" class="primary" @click="ouvrirForm">
            <Icon name="userPlus" :size="15" /> Nouvel employe
          </button>
        </EmptyState>

        <div v-else class="table-wrap">
          <table class="table-cards">
            <thead>
              <tr>
                <th v-if="modules.badges" class="col-selection">
                  <input
                    type="checkbox"
                    :checked="toutSelectionne"
                    title="Tout selectionner"
                    @change="basculerTout"
                  />
                </th>
                <th style="width: 84px">Matricule</th>
                <th>Employe</th>
                <th>Fonction</th>
                <th class="hide-sm">Telephone</th>
                <th class="td-num">Salaire</th>
                <th class="td-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in liste"
                :key="e.id"
                class="ligne-cliquable"
                :class="{ 'est-selectionnee': selection.has(e.id) }"
                @click="ouvrirFiche(e)"
              >
                <td v-if="modules.badges" data-label="" class="col-selection" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selection.has(e.id)"
                    :aria-label="`Selectionner ${e.prenom} ${e.nom}`"
                    @change="basculerSelection(e.id)"
                  />
                </td>
                <td data-label="Matricule">
                  <span class="matricule">{{ e.matricule }}</span>
                </td>
                <td data-label="Employe" class="td-titre">
                  <div class="row" style="gap: 9px">
                    <span class="avatar-employe">
                      <img v-if="e.photo" :src="assetUrl(e.photo)" alt="" />
                      <span v-else>{{ (e.prenom[0] || '') + (e.nom[0] || '') }}</span>
                    </span>
                    <span>
                      <span class="td-strong">{{ e.prenom }} {{ e.nom }}</span>
                      <span v-if="e.vendeuse_code" class="badge accent" style="margin-left: 6px">
                        <Icon name="cart" :size="11" /> Vend.
                      </span>
                      <div class="small muted">Depuis le {{ formatDateCourt(e.date_embauche) }}</div>
                    </span>
                  </div>
                </td>
                <td data-label="Fonction">
                  <span v-if="e.fonction" class="badge">{{ e.fonction }}</span>
                  <span v-else class="badge danger">Non definie</span>
                </td>
                <td data-label="Telephone" class="muted hide-sm">{{ e.telephone || '—' }}</td>
                <td data-label="Salaire" class="td-num tnum td-strong">
                  {{ e.salaire_actuel ? formatMontant(e.salaire_actuel) : '—' }}
                </td>
                <td data-label="" class="td-actions">
                  <button type="button" class="btn-sm btn-ghost" title="Ouvrir la fiche" @click.stop="ouvrirFiche(e)">
                    <Icon name="eye" :size="15" />
                  </button>
                  <button
                    type="button"
                    class="btn-sm btn-ghost"
                    :title="e.actif ? 'Archiver' : 'Reactiver'"
                    :style="e.actif ? 'color: var(--danger)' : ''"
                    @click.stop="basculerArchive(e)"
                  >
                    <Icon name="toggle" :size="15" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Barre de selection : n'apparait que lorsqu'il y a quelque chose a
         imprimer, et suit le defilement pour rester atteignable. -->
    <div v-if="selection.size" class="barre-selection">
      <span class="small">
        <strong>{{ selection.size }}</strong> badge(s) selectionne(s)
      </span>
      <div class="row" style="gap: 8px">
        <button type="button" class="btn-sm" @click="viderSelection">Tout deselectionner</button>
        <button type="button" class="btn-sm primary" @click="imprimerSelection">
          <Icon name="idCard" :size="14" /> Imprimer les badges
        </button>
      </div>
    </div>

    <GestionFonctions
      v-if="fonctionsVisible"
      @close="fonctionsVisible = false"
      @change="rechargerFonctions"
    />

    <!-- ============ Creation ============ -->
    <Modal v-if="formVisible" title="Nouvel employe" size="lg" @close="formVisible = false">
      <!-- Le matricule n'est connu qu'apres creation : on le montre ici, une
           fois, parce que c'est ce qu'il faut communiquer a la personne. -->
      <div v-if="dernierCree" class="stack" style="gap: 14px">
        <div class="alert alert-success">
          <Icon name="check" :size="16" />
          <span>Fiche creee. Le matricule ci-dessous figure sur son badge.</span>
        </div>
        <div class="identifiants">
          <div class="identifiant-ligne">
            <span>
              <span class="stat-label">Matricule</span>
              <span class="identifiant-valeur mono">{{ dernierCree.matricule }}</span>
            </span>
          </div>
          <div class="identifiant-ligne">
            <span>
              <span class="stat-label">Employe</span>
              <span class="identifiant-valeur">{{ dernierCree.prenom }} {{ dernierCree.nom }}</span>
            </span>
          </div>
        </div>
        <div class="row wrap">
          <button type="button" class="primary" @click="ouvrirFiche(dernierCree)">
            <Icon name="idCard" :size="15" /> Ouvrir la fiche
          </button>
          <button type="button" @click="ouvrirForm">
            <Icon name="userPlus" :size="15" /> Creer un autre employe
          </button>
        </div>
      </div>

      <form v-else id="form-employe" @submit.prevent="soumettre">
        <p class="small muted mb-3">
          Le matricule est genere automatiquement. Seuls le nom, la fonction et le salaire
          sont indispensables : le reste du dossier se complete depuis la fiche.
        </p>

        <div class="grid-champs">
          <div class="field">
            <label>Prenom <span class="champ-requis">*</span></label>
            <input v-model="form.prenom" type="text" required maxlength="100" />
          </div>
          <div class="field">
            <label>Nom <span class="champ-requis">*</span></label>
            <input v-model="form.nom" type="text" required maxlength="100" />
          </div>
          <div class="field">
            <label>Fonction <span class="champ-requis">*</span></label>
            <div class="row" style="gap: 7px">
              <select v-model="form.fonction_id" required class="flex-1">
                <option value="" disabled>Choisir une fonction</option>
                <option v-for="f in fonctions" :key="f.id" :value="f.id">{{ f.nom }}</option>
              </select>
              <button type="button" class="icon-btn" title="Gerer les fonctions" @click="fonctionsVisible = true">
                <Icon name="settings" :size="15" />
              </button>
            </div>
            <span v-if="!fonctions.length" class="field-error">
              Aucune fonction definie. Creez-en une avec le bouton ci-contre.
            </span>
          </div>
          <div class="field">
            <label>Salaire mensuel <span class="champ-requis">*</span></label>
            <input v-model="form.salaire" type="number" min="0" step="1" required />
            <span class="field-hint">Modifiable ensuite, avec historique</span>
          </div>
          <div class="field">
            <label>Date d'embauche</label>
            <input v-model="form.date_embauche" type="date" />
          </div>
          <div class="field">
            <label>Type de contrat</label>
            <select v-model="form.type_contrat">
              <option value="">Non precise</option>
              <option value="CDI">CDI</option>
              <option value="CDD">CDD</option>
              <option value="Essai">Periode d'essai</option>
              <option value="Stage">Stage</option>
              <option value="Prestation">Prestation</option>
            </select>
          </div>
          <div class="field">
            <label>Telephone</label>
            <input v-model="form.telephone" type="tel" maxlength="60" />
          </div>
          <div class="field">
            <label>Sexe</label>
            <select v-model="form.sexe">
              <option value="">Non precise</option>
              <option value="F">Feminin</option>
              <option value="M">Masculin</option>
            </select>
          </div>
          <div class="field">
            <label>Numero de CNI</label>
            <input v-model="form.numero_cni" type="text" maxlength="60" />
          </div>
          <div class="field">
            <label>Ville</label>
            <input v-model="form.ville" type="text" maxlength="100" />
          </div>
        </div>

        <p v-if="formErreur" class="alert alert-danger mt-3">
          <Icon name="alert" :size="16" /><span>{{ formErreur }}</span>
        </p>
      </form>

      <template v-if="!dernierCree" #footer>
        <button type="button" @click="formVisible = false">Annuler</button>
        <button type="submit" form="form-employe" class="primary" :disabled="soumission">
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
.est-selectionnee { background: var(--accent-soft); }

.col-selection { width: 38px; text-align: center; }
.col-selection input { width: 16px; height: 16px; margin: 0; cursor: pointer; }

/* Barre d'impression : ancree en bas, au-dessus de la navigation mobile pour ne
   pas la recouvrir. */
.barre-selection {
  position: sticky;
  bottom: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px solid var(--accent);
  border-radius: var(--r-md);
  background: var(--bg-card, #fff);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.14));
}
@media (max-width: 700px) {
  .barre-selection { bottom: calc(var(--bottom-nav-h, 62px) + 10px); }
}

.matricule {
  display: inline-block;
  padding: 2px 7px;
  border-radius: var(--r-sm, 5px);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
  color: var(--text-h);
}

.avatar-employe {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--accent-soft);
  color: var(--accent-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
}
.avatar-employe img { width: 100%; height: 100%; object-fit: cover; }

/* Deux colonnes des qu'il y a la place, une seule sur telephone. `minmax(0, 1fr)`
   et non `1fr` : la borne basse de `1fr` est la largeur du contenu, ce qui fait
   deborder la grille des qu'un champ porte un texte long. */
.grid-champs {
  display: grid;
  gap: 13px 15px;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
}
.champ-requis { color: var(--danger); margin-left: 2px; }

.identifiants {
  border: 1px dashed var(--border-strong, var(--border));
  border-radius: var(--r-md);
  overflow: hidden;
}
.identifiant-ligne { padding: 11px 14px; }
.identifiant-ligne + .identifiant-ligne { border-top: 1px dashed var(--border); }
.identifiant-valeur {
  display: block;
  margin-top: 2px;
  font-size: 18px;
  font-weight: 680;
  color: var(--text-h);
  letter-spacing: 0.03em;
}
</style>
