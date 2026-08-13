<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import api, { assetUrl } from '../api/client'
import { useToastStore } from '../stores/toasts'
import { useAuthStore } from '../stores/auth'
import { telechargerDocument, nommerDocument } from '../utils/telecharger'
import { formatMontant, formatDate, formatDateCourt } from '../utils/format'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import StatCard from '../components/ui/StatCard.vue'
import Icon from '../components/ui/Icon.vue'

const route = useRoute()
const toasts = useToastStore()
const auth = useAuthStore()

const cycle = ref(null)
const loading = ref(true)
const erreur = ref('')
const filtreStatut = ref('tous')
const recherche = ref('')

const STATUTS = [
  { id: 'tous', label: 'Tous' },
  { id: 'non_paye', label: 'Non payes' },
  { id: 'partiel', label: 'Partiels' },
  { id: 'paye', label: 'Soldes' },
]

const lignes = computed(() => {
  const base = cycle.value?.lignes || []
  const q = recherche.value.trim().toLowerCase()
  return base.filter((l) => {
    if (filtreStatut.value !== 'tous' && l.statut !== filtreStatut.value) return false
    if (!q) return true
    return `${l.nom_complet_snapshot} ${l.matricule_snapshot} ${l.fonction_snapshot || ''}`
      .toLowerCase().includes(q)
  })
})

const compteurs = computed(() => {
  const base = cycle.value?.lignes || []
  return {
    tous: base.length,
    non_paye: base.filter((l) => l.statut === 'non_paye').length,
    partiel: base.filter((l) => l.statut === 'partiel').length,
    paye: base.filter((l) => l.statut === 'paye').length,
  }
})

const estCloture = computed(() => cycle.value?.statut === 'cloture')

function restant(ligne) {
  return Number(ligne.net_a_payer) - Number(ligne.montant_paye)
}

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get(`/paie/cycles/${route.params.id}`)
    cycle.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

/* --- Paiement ------------------------------------------------------------- */

const paiementVisible = ref(false)
const ligneActive = ref(null)
const paiement = reactive({ montant: '', mode_paiement: 'especes', note: '' })
const paiementErreur = ref('')
const paiementSoumission = ref(false)

// Ajustement particulier, saisi dans la meme fenetre que le paiement : c'est au
// moment de payer qu'on se rend compte qu'il faut retenir ou ajouter quelque
// chose, pas avant.
const ajustementOuvert = ref(false)
const ajustement = reactive({ montant: '', motif: '' })
const ajustementSoumission = ref(false)

function ouvrirPaiement(ligne) {
  ligneActive.value = ligne
  Object.assign(paiement, {
    // Le solde complet est propose par defaut : c'est le cas courant, et un
    // champ prerempli evite de retaper un montant qu'on connait deja.
    montant: restant(ligne),
    mode_paiement: 'especes',
    note: '',
  })
  Object.assign(ajustement, {
    montant: Number(ligne.ajustement_particulier) || '',
    motif: ligne.ajustement_motif || '',
  })
  ajustementOuvert.value = Number(ligne.ajustement_particulier) !== 0
  paiementErreur.value = ''
  paiementVisible.value = true
}

const estPaiementPartiel = computed(() => {
  if (!ligneActive.value) return false
  return Number(paiement.montant) > 0 && Number(paiement.montant) < restant(ligneActive.value) - 0.005
})

async function appliquerAjustement() {
  ajustementSoumission.value = true
  paiementErreur.value = ''
  try {
    const { data } = await api.patch(`/paie/lignes/${ligneActive.value.id}/ajustement`, {
      montant: Number(ajustement.montant || 0),
      motif: ajustement.motif || null,
    })
    await charger()
    ligneActive.value = cycle.value.lignes.find((l) => l.id === data.id) || data
    paiement.montant = restant(ligneActive.value)
    toasts.succes('Ajustement applique')
  } catch (err) {
    paiementErreur.value = err.response?.data?.message || 'Erreur'
  } finally {
    ajustementSoumission.value = false
  }
}

const confirmationVisible = ref(false)

function demanderConfirmation() {
  paiementErreur.value = ''
  const montant = Number(paiement.montant)
  if (!(montant > 0)) {
    paiementErreur.value = 'Indiquez un montant strictement positif.'
    return
  }
  if (montant > restant(ligneActive.value) + 0.005) {
    paiementErreur.value = `Le montant depasse le reste a payer (${formatMontant(restant(ligneActive.value))}).`
    return
  }
  confirmationVisible.value = true
}

async function validerPaiement() {
  paiementSoumission.value = true
  try {
    const { data } = await api.post(`/paie/lignes/${ligneActive.value.id}/versements`, {
      montant: Number(paiement.montant),
      mode_paiement: paiement.mode_paiement,
      note: paiement.note || null,
    })
    confirmationVisible.value = false
    paiementVisible.value = false
    toasts.succes(`Paiement enregistre — recu ${data.numero_recu}`)
    await charger()
    // Le recu part immediatement : c'est ce papier qu'on fait signer, il n'y a
    // aucune raison d'obliger a le retrouver dans une liste.
    await telechargerRecu(data.numero_recu)
  } catch (err) {
    confirmationVisible.value = false
    paiementErreur.value = err.response?.data?.message || 'Erreur lors du paiement'
  } finally {
    paiementSoumission.value = false
  }
}

async function telechargerRecu(numero) {
  await telechargerDocument(`/exports/recus/${numero}.pdf`, {
    libelle: `Recu ${numero}`,
    nomFichier: nommerDocument(`recu-${numero}`),
  })
}

async function cloturer() {
  try {
    await api.patch(`/paie/cycles/${route.params.id}/cloturer`)
    toasts.succes('Fiche de paie cloturee')
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  }
}

const cloturVisible = ref(false)

onMounted(charger)
</script>

<template>
  <div>
    <div class="row mb-3">
      <RouterLink to="/paie" class="btn btn-sm btn-ghost">
        <Icon name="chevronLeft" :size="15" /> Toutes les fiches de paie
      </RouterLink>
    </div>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div v-if="loading" class="card"><div class="card-body"><div class="skeleton" style="height: 70px" /></div></div>

    <template v-else-if="cycle">
      <div class="card mb-4">
        <div class="card-body entete-cycle">
          <div class="flex-1" style="min-width: 0">
            <div class="row wrap" style="gap: 9px">
              <h1 class="titre-cycle">{{ cycle.libelle || `Periode ${cycle.reference}` }}</h1>
              <span class="badge" :class="estCloture ? '' : 'success'">
                {{ estCloture ? 'Cloturee' : 'Ouverte' }}
              </span>
            </div>
            <p class="sous-titre-cycle">
              Du {{ formatDateCourt(cycle.periode_debut) }} au {{ formatDateCourt(cycle.periode_fin) }}
              — reference <span class="mono">{{ cycle.reference }}</span>
            </p>
            <p v-if="cycle.ajustement_sens" class="mt-2">
              <span class="badge" :class="cycle.ajustement_sens === 'augmentation' ? 'success' : 'danger'">
                <Icon :name="cycle.ajustement_sens === 'augmentation' ? 'arrowUp' : 'arrowDown'" :size="12" />
                {{ cycle.ajustement_sens === 'augmentation' ? 'Prime generale' : 'Retenue generale' }}
                {{ cycle.ajustement_valeur }}{{ cycle.ajustement_mode === 'pourcentage' ? ' %' : ' F' }}
              </span>
              <span v-if="cycle.ajustement_motif" class="small muted"> — {{ cycle.ajustement_motif }}</span>
            </p>
          </div>
          <button
            v-if="auth.isAdmin && !estCloture && cycle.totaux.reste_a_payer <= 0"
            type="button"
            @click="cloturVisible = true"
          >
            <Icon name="check" :size="15" /> Cloturer
          </button>
        </div>
      </div>

      <div class="grid grid-stats mb-4">
        <StatCard label="Employes a payer" :value="cycle.totaux.effectif" icon="users" tone="accent" />
        <StatCard label="Total a payer" :value="formatMontant(cycle.totaux.total_a_payer)" icon="wallet" />
        <StatCard
          label="Deja verse"
          :value="formatMontant(cycle.totaux.total_paye)"
          icon="check"
          tone="success"
          :hint="`${cycle.totaux.nombre_payes} solde(s), ${cycle.totaux.nombre_partiels} partiel(s)`"
        />
        <StatCard
          label="Reste a payer"
          :value="formatMontant(cycle.totaux.reste_a_payer)"
          icon="banknote"
          :tone="Number(cycle.totaux.reste_a_payer) > 0 ? 'danger' : 'success'"
          :hint="`${cycle.totaux.nombre_non_payes} employe(s) non paye(s)`"
        />
      </div>

      <div class="card">
        <div class="card-head">
          <div class="btn-group">
            <button
              v-for="s in STATUTS"
              :key="s.id"
              type="button"
              :class="{ 'is-active': filtreStatut === s.id }"
              @click="filtreStatut = s.id"
            >
              {{ s.label }} <span class="tab-count">{{ compteurs[s.id] }}</span>
            </button>
          </div>
          <div class="search">
            <Icon name="search" :size="15" />
            <input v-model="recherche" type="search" placeholder="Nom ou matricule..." />
          </div>
        </div>

        <div class="card-body card-body-flush">
          <EmptyState
            v-if="!lignes.length"
            icon="users"
            title="Aucun employe"
            desc="Aucune ligne ne correspond a ce filtre."
          />

          <div v-else class="table-wrap">
            <table class="table-cards">
              <thead>
                <tr>
                  <th>Employe</th>
                  <th class="td-num hide-sm">Base</th>
                  <th class="td-num hide-sm">Ajustements</th>
                  <th class="td-num">Net a payer</th>
                  <th class="td-num">Verse</th>
                  <th>Statut</th>
                  <th class="td-actions"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in lignes" :key="l.id">
                  <td data-label="Employe" class="td-titre">
                    <div class="row" style="gap: 9px">
                      <span class="avatar-employe">
                        <img v-if="l.photo" :src="assetUrl(l.photo)" alt="" />
                        <span v-else>{{ l.nom_complet_snapshot.split(' ').map((m) => m[0]).slice(0, 2).join('') }}</span>
                      </span>
                      <span style="min-width: 0">
                        <span class="td-strong">{{ l.nom_complet_snapshot }}</span>
                        <div class="small muted">
                          <span class="mono">{{ l.matricule_snapshot }}</span>
                          <template v-if="l.fonction_snapshot"> · {{ l.fonction_snapshot }}</template>
                        </div>
                      </span>
                    </div>
                  </td>
                  <td data-label="Base" class="td-num tnum muted hide-sm">{{ formatMontant(l.salaire_base) }}</td>
                  <td data-label="Ajustements" class="td-num hide-sm">
                    <div v-if="Number(l.ajustement_general)" class="small" :class="Number(l.ajustement_general) > 0 ? 'positif' : 'negatif'">
                      {{ Number(l.ajustement_general) > 0 ? '+' : '' }}{{ formatMontant(l.ajustement_general) }}
                      <span class="muted">gen.</span>
                    </div>
                    <div v-if="Number(l.ajustement_particulier)" class="small" :class="Number(l.ajustement_particulier) > 0 ? 'positif' : 'negatif'">
                      {{ Number(l.ajustement_particulier) > 0 ? '+' : '' }}{{ formatMontant(l.ajustement_particulier) }}
                      <span class="muted">part.</span>
                    </div>
                    <span v-if="!Number(l.ajustement_general) && !Number(l.ajustement_particulier)" class="muted small">—</span>
                  </td>
                  <td data-label="Net a payer" class="td-num tnum td-strong">{{ formatMontant(l.net_a_payer) }}</td>
                  <td data-label="Verse" class="td-num tnum">
                    {{ formatMontant(l.montant_paye) }}
                    <div v-if="restant(l) > 0 && Number(l.montant_paye) > 0" class="small reste-du">
                      reste {{ formatMontant(restant(l)) }}
                    </div>
                  </td>
                  <td data-label="Statut">
                    <span
                      class="badge"
                      :class="l.statut === 'paye' ? 'success' : (l.statut === 'partiel' ? 'warning' : 'danger')"
                    >
                      {{ l.statut === 'paye' ? 'Paye' : (l.statut === 'partiel' ? 'Partiel' : 'Non paye') }}
                    </span>
                  </td>
                  <td data-label="" class="td-actions">
                    <button
                      v-if="auth.isAdmin && !estCloture && restant(l) > 0"
                      type="button"
                      class="btn-sm primary"
                      @click="ouvrirPaiement(l)"
                    >
                      <Icon name="banknote" :size="14" /> Payer
                    </button>
                    <button
                      v-for="v in l.versements"
                      :key="v.id"
                      type="button"
                      class="btn-sm btn-ghost recu-lien"
                      :title="`${formatMontant(v.montant)} le ${formatDate(v.paye_le)}`"
                      @click="telechargerRecu(v.numero_recu)"
                    >
                      <Icon name="download" :size="13" /> {{ v.numero_recu }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ Paiement ============ -->
    <Modal v-if="paiementVisible && ligneActive" title="Payer un employe" @close="paiementVisible = false">
      <div class="stack" style="gap: 15px">
        <div class="bloc-employe">
          <span class="avatar-employe grand">
            <img v-if="ligneActive.photo" :src="assetUrl(ligneActive.photo)" alt="" />
            <span v-else>{{ ligneActive.nom_complet_snapshot.split(' ').map((m) => m[0]).slice(0, 2).join('') }}</span>
          </span>
          <div style="min-width: 0">
            <div class="td-strong" style="font-size: 15px">{{ ligneActive.nom_complet_snapshot }}</div>
            <div class="small muted">
              <span class="mono">{{ ligneActive.matricule_snapshot }}</span>
              <template v-if="ligneActive.fonction_snapshot"> · {{ ligneActive.fonction_snapshot }}</template>
            </div>
          </div>
        </div>

        <!-- Decomposition : l'employe doit pouvoir suivre le calcul, et celui
             qui paie doit voir d'ou vient le montant. -->
        <div class="decompte">
          <div class="decompte-ligne">
            <span>Salaire de base</span>
            <span class="tnum">{{ formatMontant(ligneActive.salaire_base) }}</span>
          </div>
          <div v-if="Number(ligneActive.ajustement_general)" class="decompte-ligne" :class="Number(ligneActive.ajustement_general) > 0 ? 'positif' : 'negatif'">
            <span>{{ Number(ligneActive.ajustement_general) > 0 ? 'Prime generale' : 'Retenue generale' }}
              <span v-if="cycle.ajustement_motif" class="muted small">— {{ cycle.ajustement_motif }}</span>
            </span>
            <span class="tnum">{{ Number(ligneActive.ajustement_general) > 0 ? '+' : '' }}{{ formatMontant(ligneActive.ajustement_general) }}</span>
          </div>
          <div v-if="Number(ligneActive.ajustement_particulier)" class="decompte-ligne" :class="Number(ligneActive.ajustement_particulier) > 0 ? 'positif' : 'negatif'">
            <span>{{ Number(ligneActive.ajustement_particulier) > 0 ? 'Prime particuliere' : 'Retenue particuliere' }}
              <span v-if="ligneActive.ajustement_motif" class="muted small">— {{ ligneActive.ajustement_motif }}</span>
            </span>
            <span class="tnum">{{ Number(ligneActive.ajustement_particulier) > 0 ? '+' : '' }}{{ formatMontant(ligneActive.ajustement_particulier) }}</span>
          </div>
          <div class="decompte-ligne est-total">
            <span>Net a payer</span>
            <span class="tnum">{{ formatMontant(ligneActive.net_a_payer) }}</span>
          </div>
          <div v-if="Number(ligneActive.montant_paye)" class="decompte-ligne">
            <span>Deja verse</span>
            <span class="tnum">− {{ formatMontant(ligneActive.montant_paye) }}</span>
          </div>
          <div class="decompte-ligne est-reste">
            <span>Reste a payer</span>
            <span class="tnum">{{ formatMontant(restant(ligneActive)) }}</span>
          </div>
        </div>

        <!-- Ajustement particulier -->
        <div>
          <button type="button" class="btn-sm btn-ghost" @click="ajustementOuvert = !ajustementOuvert">
            <Icon :name="ajustementOuvert ? 'chevronDown' : 'chevronRight'" :size="14" />
            Prime ou retenue pour cet employe
          </button>
          <div v-if="ajustementOuvert" class="encart-ajustement">
            <div class="field-row">
              <div class="field">
                <label>Montant</label>
                <input v-model="ajustement.montant" type="number" step="1" placeholder="0" />
                <span class="field-hint">Negatif pour une retenue</span>
              </div>
              <div class="field">
                <label>Motif</label>
                <input v-model="ajustement.motif" type="text" maxlength="200" placeholder="Avance, prime..." />
              </div>
            </div>
            <button type="button" class="btn-sm" :disabled="ajustementSoumission" @click="appliquerAjustement">
              <span v-if="ajustementSoumission" class="spinner" />
              Appliquer l'ajustement
            </button>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Montant a verser <span class="champ-requis">*</span></label>
            <input v-model="paiement.montant" type="number" min="0" step="1" required />
          </div>
          <div class="field">
            <label>Mode de reglement</label>
            <select v-model="paiement.mode_paiement">
              <option value="especes">Especes</option>
              <option value="mobile money">Mobile money</option>
              <option value="virement">Virement</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Note <span class="muted">(optionnel)</span></label>
          <input v-model="paiement.note" type="text" maxlength="300" />
        </div>

        <p v-if="estPaiementPartiel" class="alert alert-warning">
          <Icon name="warning" :size="16" />
          <span>
            Paiement partiel : il restera
            <strong>{{ formatMontant(restant(ligneActive) - Number(paiement.montant)) }}</strong>
            a verser. La ligne restera ouverte et vous pourrez la solder plus tard.
          </span>
        </p>

        <p v-if="paiementErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ paiementErreur }}</span>
        </p>
      </div>

      <template #footer>
        <button type="button" @click="paiementVisible = false">Annuler</button>
        <button type="button" class="primary" @click="demanderConfirmation">
          <Icon name="banknote" :size="15" /> Valider le paiement
        </button>
      </template>
    </Modal>

    <!-- Confirmation : un paiement est irreversible, il ne doit jamais partir
         sur un clic isole. -->
    <Modal v-if="confirmationVisible && ligneActive" title="Confirmer le paiement" @close="confirmationVisible = false">
      <p>
        Verser <strong>{{ formatMontant(paiement.montant) }}</strong> a
        <strong>{{ ligneActive.nom_complet_snapshot }}</strong>
        ({{ paiement.mode_paiement }}) ?
      </p>
      <p class="small muted mt-3">
        Le recu sera genere et telecharge immediatement, en double exemplaire :
        un pour l'employe, un a conserver comme souche.
      </p>
      <template #footer>
        <button type="button" @click="confirmationVisible = false">Annuler</button>
        <button type="button" class="primary" :disabled="paiementSoumission" @click="validerPaiement">
          <span v-if="paiementSoumission" class="spinner" />
          Confirmer et editer le recu
        </button>
      </template>
    </Modal>

    <Modal v-if="cloturVisible" title="Cloturer cette fiche de paie ?" @close="cloturVisible = false">
      <p>
        Une fiche cloturee ne peut plus recevoir de paiement ni d'ajustement.
        Les recus deja emis restent consultables et telechargeables.
      </p>
      <template #footer>
        <button type="button" @click="cloturVisible = false">Annuler</button>
        <button type="button" class="primary" @click="cloturVisible = false; cloturer()">Cloturer</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.entete-cycle { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.titre-cycle { margin: 0; font-size: 20px; font-weight: 680; letter-spacing: -0.02em; color: var(--text-h); }
.sous-titre-cycle { margin: 3px 0 0; font-size: 13px; color: var(--text-muted); }

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
.avatar-employe.grand { width: 46px; height: 46px; font-size: 16px; }
.avatar-employe img { width: 100%; height: 100%; object-fit: cover; }

.bloc-employe {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}

.decompte { border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
.decompte-ligne {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 13px;
  font-size: 13px;
}
.decompte-ligne + .decompte-ligne { border-top: 1px solid var(--border); }
.decompte-ligne.est-total { font-weight: 650; color: var(--text-h); background: var(--bg-subtle); }
.decompte-ligne.est-reste {
  font-weight: 700;
  font-size: 15px;
  color: var(--accent-text);
  background: var(--accent-soft);
}
.positif { color: var(--success); }
.negatif { color: var(--danger); }
.reste-du { color: var(--danger); font-weight: 600; }

.encart-ajustement {
  margin-top: 9px;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
}

.recu-lien { font-family: var(--mono); font-size: 11px; }
.champ-requis { color: var(--danger); margin-left: 2px; }
</style>
