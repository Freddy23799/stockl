<script setup>
import { ref, reactive, onMounted } from 'vue'
import api from '../../api/client'
import { useToastStore } from '../../stores/toasts'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import EmptyState from './EmptyState.vue'
import Icon from './Icon.vue'

// -----------------------------------------------------------------------------
// Fonctions du personnel : creation, modification, suppression.
//
// Une reference fermee plutot qu'un champ libre. Tant que la fonction etait du
// texte, "Vendeuse", "vendeuse" et "Vendeuse " comptaient pour trois metiers et
// tous les regroupements devenaient faux.
//
// La suppression est refusee des qu'une periode de carriere porte la fonction :
// l'effacer emporterait une partie de l'historique de paie. La desactivation
// remplit le besoin reel - la retirer des choix proposes sans toucher au passe.
// -----------------------------------------------------------------------------

const emit = defineEmits(['close', 'change'])
const toasts = useToastStore()

const fonctions = ref([])
const loading = ref(true)
const erreur = ref('')

const form = reactive({ id: null, nom: '', description: '' })
const soumission = ref(false)
const formErreur = ref('')
const aSupprimer = ref(null)

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const { data } = await api.get('/employes/fonctions', { params: { inclure_inactives: 'true' } })
    fonctions.value = data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

function reinitialiser() {
  Object.assign(form, { id: null, nom: '', description: '' })
  formErreur.value = ''
}

function editer(fonction) {
  Object.assign(form, {
    id: fonction.id,
    nom: fonction.nom,
    description: fonction.description || '',
  })
  formErreur.value = ''
}

async function soumettre() {
  if (!form.nom.trim()) {
    formErreur.value = 'Le nom de la fonction est requis'
    return
  }
  soumission.value = true
  formErreur.value = ''
  try {
    if (form.id) {
      await api.put(`/employes/fonctions/${form.id}`, { nom: form.nom, description: form.description })
      toasts.succes(`Fonction « ${form.nom} » modifiee`)
    } else {
      await api.post('/employes/fonctions', { nom: form.nom, description: form.description })
      toasts.succes(`Fonction « ${form.nom} » creee`)
    }
    reinitialiser()
    await charger()
    emit('change')
  } catch (err) {
    formErreur.value = err.response?.data?.message || 'Erreur'
  } finally {
    soumission.value = false
  }
}

async function basculerActif(fonction) {
  try {
    await api.put(`/employes/fonctions/${fonction.id}`, { actif: !fonction.actif })
    toasts.succes(
      fonction.actif
        ? `« ${fonction.nom} » ne sera plus proposee`
        : `« ${fonction.nom} » est de nouveau proposee`
    )
    await charger()
    emit('change')
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  }
}

async function supprimer() {
  const fonction = aSupprimer.value
  aSupprimer.value = null
  try {
    await api.delete(`/employes/fonctions/${fonction.id}`)
    toasts.succes(`Fonction « ${fonction.nom} » supprimee`)
    if (form.id === fonction.id) reinitialiser()
    await charger()
    emit('change')
  } catch (err) {
    // Le refus est une information utile, pas un incident : il explique
    // pourquoi et propose la desactivation. Il merite mieux qu'un toast fugace.
    erreur.value = err.response?.data?.message || 'Suppression impossible'
  }
}

onMounted(charger)
</script>

<template>
  <Modal title="Fonctions du personnel" size="lg" @close="emit('close')">
    <div class="stack" style="gap: 16px">
      <p class="small muted">
        Les fonctions proposees lors de la creation d'un employe ou d'un changement de
        carriere. Une fonction deja portee par quelqu'un ne peut pas etre supprimee :
        desactivez-la pour la retirer des choix sans toucher a l'historique.
      </p>

      <p v-if="erreur" class="alert alert-warning">
        <Icon name="warning" :size="16" /><span>{{ erreur }}</span>
      </p>

      <!-- Formulaire : creation ou modification selon `form.id` -->
      <form class="encart-form" @submit.prevent="soumettre">
        <div class="field-row">
          <div class="field">
            <label>{{ form.id ? 'Modifier la fonction' : 'Nouvelle fonction' }}</label>
            <input v-model="form.nom" type="text" maxlength="120" placeholder="Vendeuse, magasinier..." />
          </div>
          <div class="field">
            <label>Description <span class="muted">(optionnel)</span></label>
            <input v-model="form.description" type="text" maxlength="300" />
          </div>
        </div>

        <p v-if="formErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ formErreur }}</span>
        </p>

        <div class="row" style="gap: 8px">
          <button type="submit" class="primary btn-sm" :disabled="soumission">
            <span v-if="soumission" class="spinner" />
            <Icon v-else :name="form.id ? 'check' : 'plus'" :size="14" />
            {{ form.id ? 'Enregistrer' : 'Ajouter' }}
          </button>
          <button v-if="form.id" type="button" class="btn-sm" @click="reinitialiser">Annuler</button>
        </div>
      </form>

      <div v-if="loading" class="skeleton" style="height: 90px" />

      <EmptyState
        v-else-if="!fonctions.length"
        icon="briefcase"
        title="Aucune fonction"
        desc="Creez les fonctions de votre etablissement : elles seront proposees a la creation d'un employe."
      />

      <div v-else class="table-wrap">
        <table class="table-cards">
          <thead>
            <tr>
              <th>Fonction</th>
              <th class="td-num">Effectif</th>
              <th>Statut</th>
              <th class="td-actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in fonctions" :key="f.id" :class="{ 'est-inactive': !f.actif }">
              <td data-label="Fonction" class="td-titre">
                <div class="td-strong">{{ f.nom }}</div>
                <div v-if="f.description" class="small muted">{{ f.description }}</div>
              </td>
              <td data-label="Effectif" class="td-num tnum">
                {{ f.effectif }}
                <div v-if="f.periodes > f.effectif" class="small muted">
                  {{ f.periodes }} periode(s)
                </div>
              </td>
              <td data-label="Statut">
                <span class="badge" :class="f.actif ? 'success' : ''">
                  {{ f.actif ? 'Proposee' : 'Retiree' }}
                </span>
              </td>
              <td data-label="" class="td-actions">
                <button type="button" class="btn-sm btn-ghost" title="Modifier" @click="editer(f)">
                  <Icon name="edit" :size="15" />
                </button>
                <button
                  type="button"
                  class="btn-sm btn-ghost"
                  :title="f.actif ? 'Ne plus proposer' : 'Proposer de nouveau'"
                  @click="basculerActif(f)"
                >
                  <Icon name="toggle" :size="15" />
                </button>
                <!-- Le bouton disparait plutot que d'etre desactive quand la
                     fonction est utilisee : un bouton grise fait cliquer trois
                     fois avant de comprendre. L'infobulle dit pourquoi. -->
                <button
                  v-if="!f.periodes"
                  type="button"
                  class="btn-sm btn-ghost"
                  style="color: var(--danger)"
                  title="Supprimer"
                  @click="aSupprimer = f"
                >
                  <Icon name="trash" :size="15" />
                </button>
                <span
                  v-else
                  class="icon-verrou"
                  title="Cette fonction est utilisee : elle ne peut pas etre supprimee sans effacer une partie de l'historique."
                >
                  <Icon name="shield" :size="14" />
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template #footer>
      <button type="button" class="primary" @click="emit('close')">Termine</button>
    </template>
  </Modal>

  <ConfirmDialog
    v-if="aSupprimer"
    title="Supprimer cette fonction ?"
    :message="`« ${aSupprimer.nom} » n'est portee par personne et sera definitivement supprimee.`"
    confirm-label="Supprimer"
    @confirm="supprimer"
    @cancel="aSupprimer = null"
  />
</template>

<style scoped>
.encart-form {
  padding: 13px;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}

.est-inactive { opacity: 0.62; }

.icon-verrou {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: var(--text-muted);
  cursor: help;
}
</style>
