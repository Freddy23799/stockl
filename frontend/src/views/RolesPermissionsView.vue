<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api/client'
import { useToastStore } from '../stores/toasts'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Icon from '../components/ui/Icon.vue'

const toasts = useToastStore()
const roles = ref([])
const catalogue = ref([])
const matrice = ref([])
const roleId = ref(null)
const chargement = ref(true)
const sauvegarde = ref(false)
const erreur = ref('')
const nouveauRole = reactive({ code: '', nom: '' })

const roleActif = computed(() => roles.value.find((r) => r.id === roleId.value))
const droits = computed(() => new Map(
  matrice.value.filter((p) => p.role_id === roleId.value).map((p) => [p.permission_id, p.perimetre])
))
const modules = computed(() => {
  const groupes = new Map()
  for (const permission of catalogue.value) {
    if (!groupes.has(permission.module)) groupes.set(permission.module, [])
    groupes.get(permission.module).push(permission)
  }
  return [...groupes.entries()]
})

function libelle(valeur) {
  return String(valeur).replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

async function charger() {
  chargement.value = true
  erreur.value = ''
  try {
    const [rolesRes, permissionsRes, matriceRes] = await Promise.all([
      api.get('/roles'), api.get('/roles/permissions'), api.get('/roles/matrice'),
    ])
    roles.value = rolesRes.data
    catalogue.value = permissionsRes.data
    matrice.value = matriceRes.data
    roleId.value = roleId.value || roles.value[0]?.id || null
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Impossible de charger les roles et permissions.'
  } finally {
    chargement.value = false
  }
}

function basculer(permission) {
  if (roleActif.value?.super_admin) return
  const sans = matrice.value.filter((p) => !(p.role_id === roleId.value && p.permission_id === permission.id))
  matrice.value = droits.value.has(permission.id)
    ? sans
    : [...sans, { role_id: roleId.value, permission_id: permission.id, perimetre: 'company' }]
}

function changerPerimetre(permission, perimetre) {
  matrice.value = matrice.value.map((p) => (
    p.role_id === roleId.value && p.permission_id === permission.id ? { ...p, perimetre } : p
  ))
}

async function enregistrer() {
  if (!roleActif.value || roleActif.value.super_admin) return
  sauvegarde.value = true
  try {
    const permissions = matrice.value
      .filter((p) => p.role_id === roleId.value)
      .map(({ permission_id, perimetre }) => ({ permission_id, perimetre }))
    await api.put(`/roles/${roleId.value}/permissions`, { permissions })
    toasts.succes('Permissions enregistrees')
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Enregistrement impossible')
  } finally {
    sauvegarde.value = false
  }
}

async function creerRole() {
  try {
    const { data } = await api.post('/roles', nouveauRole)
    nouveauRole.code = ''
    nouveauRole.nom = ''
    await charger()
    roleId.value = data.id
    toasts.succes('Role cree : choisissez maintenant ses permissions')
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Creation impossible')
  }
}

onMounted(charger)
</script>

<template>
  <div>
    <PageHeader title="Roles et permissions" subtitle="Chaque droit est defini par module, action et perimetre de donnees." />

    <p v-if="erreur" class="alert alert-danger"><Icon name="alert" :size="16" /> {{ erreur }}</p>
    <div v-else-if="chargement" class="card"><div class="card-body">Chargement de la matrice...</div></div>

    <template v-else>
      <div class="grid" style="grid-template-columns: minmax(220px, .7fr) minmax(0, 2fr); gap: 18px">
        <section class="card">
          <div class="card-head"><h2>Roles</h2></div>
          <div class="card-body stack">
            <button v-for="role in roles" :key="role.id" type="button" class="btn-sm" :class="role.id === roleId ? 'primary' : 'btn-ghost'" style="justify-content: space-between" @click="roleId = role.id">
              <span>{{ role.nom }}</span><span class="small muted">{{ role.nombre_comptes }}</span>
            </button>
            <hr />
            <form class="stack" @submit.prevent="creerRole">
              <strong>Nouveau role</strong>
              <input v-model="nouveauRole.nom" placeholder="Ex. Responsable commercial" required />
              <input v-model="nouveauRole.code" placeholder="responsable_commercial" required />
              <button type="submit" class="btn-sm"><Icon name="plus" :size="14" /> Creer</button>
            </form>
          </div>
        </section>

        <section v-if="roleActif" class="card">
          <div class="card-head"><div><h2>{{ roleActif.nom }}</h2><p class="small muted">{{ roleActif.super_admin ? 'Acces technique complet. Sa matrice ne peut pas etre restreinte.' : 'Cochez uniquement les actions necessaires.' }}</p></div><button v-if="!roleActif.super_admin" type="button" class="primary" :disabled="sauvegarde" @click="enregistrer">{{ sauvegarde ? 'Enregistrement...' : 'Enregistrer' }}</button></div>
          <div v-if="roleActif.super_admin" class="card-body"><p class="alert alert-warning"><Icon name="shield" :size="16" /> Ce role a un acces global a toutes les permissions, y compris celles ajoutees a l'avenir.</p></div>
          <div v-else class="card-body stack">
            <div v-for="[module, permissions] in modules" :key="module" class="permission-module">
              <h3>{{ libelle(module) }}</h3>
              <div v-for="permission in permissions" :key="permission.id" class="row" style="justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--border)">
                <label class="row" style="gap: 8px; cursor: pointer"><input type="checkbox" :checked="droits.has(permission.id)" @change="basculer(permission)" /><span>{{ libelle(permission.action) }}</span></label>
                <select v-if="droits.has(permission.id)" :value="droits.get(permission.id)" aria-label="Perimetre" @change="changerPerimetre(permission, $event.target.value)"><option value="own">Mes donnees</option><option value="team">Mon equipe</option><option value="department">Mon departement</option><option value="branch">Mon agence</option><option value="company">Entreprise</option><option value="global">Global</option></select>
              </div>
            </div>
          </div>
        </section>
        <EmptyState v-else icon="shield" title="Aucun role" desc="Creez un role pour definir ses permissions." />
      </div>
    </template>
  </div>
</template>
