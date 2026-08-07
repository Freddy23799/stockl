<script setup>
import { ref, reactive, onMounted } from 'vue'
import api from '../../api/client'
import { useToastStore } from '../../stores/toasts'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import EmptyState from './EmptyState.vue'
import Icon from './Icon.vue'

// -----------------------------------------------------------------------------
// Gestion d'une reference fermee du catalogue : rayon ou marque.
//
// Les deux ecrans sont identiques a la virgule pres - seuls changent le titre,
// l'adresse de l'API et quelques mots. Les ecrire deux fois, c'est s'assurer
// qu'une correction apportee a l'un manquera a l'autre.
//
// Une valeur deja portee par un produit ne peut pas etre supprimee : la
// desactivation repond au besoin reel, retirer l'entree des choix proposes sans
// declasser les fiches existantes.
// -----------------------------------------------------------------------------

const props = defineProps({
  titre: { type: String, required: true },
  ressource: { type: String, required: true }, // 'categories' | 'marques'
  libelle: { type: String, required: true },   // 'rayon' | 'marque'
  exemple: { type: String, default: '' },
  explication: { type: String, default: '' },
  icone: { type: String, default: 'tag' },
})

const emit = defineEmits(['close', 'change'])
const toasts = useToastStore()

const entrees = ref([])
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
    const { data } = await api.get(`/${props.ressource}`, { params: { inclure_inactives: 'true' } })
    entrees.value = data
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

function editer(entree) {
  Object.assign(form, { id: entree.id, nom: entree.nom, description: entree.description || '' })
  formErreur.value = ''
}

async function soumettre() {
  if (!form.nom.trim()) {
    formErreur.value = `Le nom ${props.libelle === 'marque' ? 'de la marque' : 'du rayon'} est requis`
    return
  }
  soumission.value = true
  formErreur.value = ''
  try {
    const corps = { nom: form.nom, description: form.description }
    if (form.id) {
      await api.put(`/${props.ressource}/${form.id}`, corps)
      toasts.succes(`« ${form.nom} » modifie`)
    } else {
      await api.post(`/${props.ressource}`, corps)
      toasts.succes(`« ${form.nom} » ajoute`)
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

async function basculerActif(entree) {
  try {
    await api.put(`/${props.ressource}/${entree.id}`, { actif: !entree.actif })
    toasts.succes(entree.actif
      ? `« ${entree.nom} » ne sera plus proposé`
      : `« ${entree.nom} » est de nouveau proposé`)
    await charger()
    emit('change')
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  }
}

async function supprimer() {
  const entree = aSupprimer.value
  aSupprimer.value = null
  try {
    await api.delete(`/${props.ressource}/${entree.id}`)
    toasts.succes(`« ${entree.nom} » supprimé`)
    if (form.id === entree.id) reinitialiser()
    await charger()
    emit('change')
  } catch (err) {
    // Le refus explique pourquoi et propose la desactivation : il merite mieux
    // qu'un toast qui disparait avant d'avoir ete lu.
    erreur.value = err.response?.data?.message || 'Suppression impossible'
  }
}

onMounted(charger)
</script>

<template>
  <Modal :title="titre" size="lg" @close="emit('close')">
    <div class="stack" style="gap: 16px">
      <p class="small muted">{{ explication }}</p>

      <p v-if="erreur" class="alert alert-warning">
        <Icon name="warning" :size="16" /><span>{{ erreur }}</span>
      </p>

      <form class="encart-form" @submit.prevent="soumettre">
        <div class="field-row">
          <div class="field">
            <label>{{ form.id ? 'Modifier' : 'Nouvelle entrée' }}</label>
            <input v-model="form.nom" type="text" maxlength="120" :placeholder="exemple" />
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
        v-else-if="!entrees.length"
        :icon="icone"
        title="Rien pour l'instant"
        :desc="explication"
      />

      <div v-else class="table-wrap">
        <table class="table-cards">
          <thead>
            <tr>
              <th>Nom</th>
              <th class="td-num">Produits</th>
              <th>Statut</th>
              <th class="td-actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in entrees" :key="e.id" :class="{ 'est-inactive': !e.actif }">
              <td data-label="Nom" class="td-titre">
                <div class="td-strong">{{ e.nom }}</div>
                <div v-if="e.description" class="small muted">{{ e.description }}</div>
              </td>
              <td data-label="Produits" class="td-num tnum">
                {{ e.produits }}
                <div v-if="e.produits > e.produits_actifs" class="small muted">
                  dont {{ e.produits_actifs }} au catalogue
                </div>
              </td>
              <td data-label="Statut">
                <span class="badge" :class="e.actif ? 'success' : ''">
                  {{ e.actif ? 'Proposé' : 'Retiré' }}
                </span>
              </td>
              <td data-label="" class="td-actions">
                <button type="button" class="btn-sm btn-ghost" title="Modifier" @click="editer(e)">
                  <Icon name="edit" :size="15" />
                </button>
                <button
                  type="button"
                  class="btn-sm btn-ghost"
                  :title="e.actif ? 'Ne plus proposer' : 'Proposer de nouveau'"
                  @click="basculerActif(e)"
                >
                  <Icon name="toggle" :size="15" />
                </button>
                <!-- Le bouton disparait plutot que d'etre grise quand l'entree
                     est utilisee : un bouton inerte fait cliquer trois fois
                     avant de comprendre. L'infobulle dit pourquoi. -->
                <button
                  v-if="!e.produits"
                  type="button"
                  class="btn-sm btn-ghost"
                  style="color: var(--danger)"
                  title="Supprimer"
                  @click="aSupprimer = e"
                >
                  <Icon name="trash" :size="15" />
                </button>
                <span
                  v-else
                  class="icon-verrou"
                  title="Des produits y sont rattachés : la suppression les laisserait sans classement."
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
      <button type="button" class="primary" @click="emit('close')">Terminé</button>
    </template>
  </Modal>

  <ConfirmDialog
    v-if="aSupprimer"
    title="Supprimer cette entrée ?"
    :message="`« ${aSupprimer.nom} » n'est rattaché à aucun produit et sera définitivement supprimé.`"
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
