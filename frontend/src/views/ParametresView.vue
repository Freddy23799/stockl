<script setup>
import { ref, reactive, onMounted } from 'vue'
import api, { assetUrl } from '../api/client'
import Modal from '../components/Modal.vue'
import { useModulesStore } from '../stores/modules'

const modules = useModulesStore()

const parametres = ref(null)
const loading = ref(true)
const erreur = ref('')

const methodeSoumission = ref(false)
const methodeMessage = ref('')

const moduleEnCours = ref(null)

const LABEL_MODULE = {
  module_ventes: 'Ventes (et Vendeuses)',
  module_fournisseurs: 'Fournisseurs',
  module_depenses: 'Depenses',
}

async function basculerModule(champ, valeur) {
  if (!valeur) {
    const ok = confirm(
      `Desactiver "${LABEL_MODULE[champ]}" ? Toutes les pages, menus et donnees lies a ce module disparaitront ` +
      `immediatement de l'interface (rien n'est supprime en base - tout reapparait tel quel si vous reactivez).`
    )
    if (!ok) return
  }
  moduleEnCours.value = champ
  try {
    const { data } = await api.put('/parametres', { [champ]: valeur })
    parametres.value = data
    await modules.charger()
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur lors du changement de module'
    // Revert visuel si l'appel echoue
    parametres.value[champ] = !valeur
  } finally {
    moduleEnCours.value = null
  }
}

const logoFichier = ref(null)
const logoEnvoi = ref(false)
const logoErreur = ref('')

const utilisateurs = ref([])
const compteVisible = ref(false)
const compteForm = reactive({ nom: '', email: '', password: '' })
const compteErreur = ref('')
const compteSoumission = ref(false)

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const [paramsRes, utilisateursRes] = await Promise.all([
      api.get('/parametres'),
      api.get('/utilisateurs'),
    ])
    parametres.value = paramsRes.data
    utilisateurs.value = utilisateursRes.data
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

onMounted(charger)

async function changerMethode() {
  methodeSoumission.value = true
  methodeMessage.value = ''
  try {
    const { data } = await api.put('/parametres', { methode_valorisation: parametres.value.methode_valorisation })
    parametres.value = data
    methodeMessage.value = 'Methode de valorisation mise a jour.'
  } catch (err) {
    methodeMessage.value = err.response?.data?.message || 'Erreur'
  } finally {
    methodeSoumission.value = false
  }
}

function surChoixLogo(e) {
  logoFichier.value = e.target.files[0] || null
}

async function envoyerLogo() {
  if (!logoFichier.value) return
  logoEnvoi.value = true
  logoErreur.value = ''
  try {
    const formData = new FormData()
    formData.append('logo', logoFichier.value)
    const { data } = await api.post('/parametres/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    parametres.value = data
    logoFichier.value = null
  } catch (err) {
    logoErreur.value = err.response?.data?.message || 'Erreur lors de l\'envoi du logo'
  } finally {
    logoEnvoi.value = false
  }
}

function ouvrirCompte() {
  Object.assign(compteForm, { nom: '', email: '', password: '' })
  compteErreur.value = ''
  compteVisible.value = true
}

async function creerCompte() {
  compteSoumission.value = true
  compteErreur.value = ''
  try {
    await api.post('/utilisateurs', compteForm)
    compteVisible.value = false
    await charger()
  } catch (err) {
    compteErreur.value = err.response?.data?.message || 'Erreur lors de la creation du compte'
  } finally {
    compteSoumission.value = false
  }
}

async function desactiverCompte(u) {
  if (!confirm(`Desactiver le compte de ${u.nom} ?`)) return
  try {
    await api.patch(`/utilisateurs/${u.id}/desactiver`)
    await charger()
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur'
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Parametres</h1>
    </div>

    <p v-if="erreur" class="error-message">{{ erreur }}</p>
    <p v-if="loading">Chargement...</p>

    <template v-else>
      <div class="card">
        <h2>Modules actifs</h2>
        <p style="font-size: 13px; opacity: 0.75; margin-bottom: 12px">
          Adaptez le systeme a votre usage reel. Un module desactive disparait entierement de
          l'interface (menu, pages, rapports) et ses routes sont bloquees meme en acces direct —
          rien n'est jamais supprime, tout revient tel quel des la reactivation.
        </p>
        <div class="module-toggle-list">
          <label class="module-toggle">
            <input
              type="checkbox"
              :checked="parametres.module_ventes"
              :disabled="moduleEnCours === 'module_ventes'"
              @change="basculerModule('module_ventes', $event.target.checked)"
            />
            <div>
              <div style="font-weight: 600">Ventes</div>
              <div style="font-size: 12px; opacity: 0.7">Enregistrement des ventes, attribution aux vendeuses, mini-rapports</div>
            </div>
          </label>
          <label class="module-toggle">
            <input
              type="checkbox"
              :checked="parametres.module_fournisseurs"
              :disabled="moduleEnCours === 'module_fournisseurs'"
              @change="basculerModule('module_fournisseurs', $event.target.checked)"
            />
            <div>
              <div style="font-weight: 600">Fournisseurs</div>
              <div style="font-size: 12px; opacity: 0.7">Fiches fournisseurs, historique et totaux des achats</div>
            </div>
          </label>
          <label class="module-toggle">
            <input
              type="checkbox"
              :checked="parametres.module_depenses"
              :disabled="moduleEnCours === 'module_depenses'"
              @change="basculerModule('module_depenses', $event.target.checked)"
            />
            <div>
              <div style="font-weight: 600">Depenses</div>
              <div style="font-size: 12px; opacity: 0.7">Suivi des depenses courantes, integrees au bilan net</div>
            </div>
          </label>
        </div>
        <p style="font-size: 12px; opacity: 0.6; margin-top: 8px">
          Produits, Stock, Rapports, Historique et Parametres restent toujours actifs (fondations du systeme).
        </p>
      </div>

      <div class="card">
        <h2>Logo de la boutique</h2>
        <p style="font-size: 13px; opacity: 0.75; margin-bottom: 12px">
          Reutilise en en-tete de tous les documents generes (rapports, exports).
        </p>
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 12px">
          <img :src="assetUrl(parametres.logo_path)" alt="Logo" style="width: 72px; height: 72px; border-radius: 12px; border: 1px solid var(--border); object-fit: cover" />
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" @change="surChoixLogo" />
          <button type="button" class="primary" :disabled="!logoFichier || logoEnvoi" @click="envoyerLogo">
            {{ logoEnvoi ? 'Envoi...' : 'Changer le logo' }}
          </button>
        </div>
        <p v-if="logoErreur" class="error-message">{{ logoErreur }}</p>
      </div>

      <div class="card">
        <h2>Valorisation du stock</h2>
        <p style="font-size: 13px; opacity: 0.75; margin-bottom: 12px">
          Configurable une seule fois pour tout le systeme.
        </p>
        <div class="form-row-inline">
          <div class="form-row">
            <label>Methode</label>
            <select v-model="parametres.methode_valorisation">
              <option value="CMP">CMP (cout moyen pondere)</option>
              <option value="FIFO">FIFO (premier entre, premier sorti)</option>
            </select>
          </div>
          <div class="form-row" style="justify-content: flex-end">
            <label>&nbsp;</label>
            <button type="button" class="primary" :disabled="methodeSoumission" @click="changerMethode">
              {{ methodeSoumission ? 'Enregistrement...' : 'Enregistrer' }}
            </button>
          </div>
        </div>
        <p v-if="methodeMessage">{{ methodeMessage }}</p>
      </div>

      <div class="card">
        <div class="page-header">
          <h2>Comptes administrateurs</h2>
          <button type="button" class="primary" @click="ouvrirCompte">+ Nouveau compte</button>
        </div>
        <p style="font-size: 13px; opacity: 0.75; margin-bottom: 12px">
          Seuls les administrateurs ont un compte de connexion. Les vendeuses sont gerees
          dans le module Vendeuses, identifiees par leur code a 6 chiffres.
        </p>
        <table>
          <thead><tr><th>Nom</th><th>Email</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="u in utilisateurs" :key="u.id">
              <td>{{ u.nom }}</td>
              <td>{{ u.email }}</td>
              <td><span class="badge" :class="u.actif ? 'success' : 'danger'">{{ u.actif ? 'Actif' : 'Inactif' }}</span></td>
              <td>
                <button type="button" class="danger" v-if="u.actif" @click="desactiverCompte(u)">Desactiver</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Modal v-if="compteVisible" title="Nouveau compte administrateur" @close="compteVisible = false">
      <form @submit.prevent="creerCompte">
        <div class="form-row">
          <label>Nom</label>
          <input v-model="compteForm.nom" required />
        </div>
        <div class="form-row">
          <label>Email</label>
          <input v-model="compteForm.email" type="email" required />
        </div>
        <div class="form-row">
          <label>Mot de passe</label>
          <input v-model="compteForm.password" type="password" required minlength="6" />
        </div>
        <p v-if="compteErreur" class="error-message">{{ compteErreur }}</p>
        <button type="submit" class="primary" :disabled="compteSoumission">
          {{ compteSoumission ? 'Creation...' : 'Creer le compte' }}
        </button>
      </form>
    </Modal>
  </div>
</template>
