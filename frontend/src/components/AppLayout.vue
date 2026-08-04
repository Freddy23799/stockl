<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useModulesStore } from '../stores/modules'
import logo from '../assets/branding/logo-machibel.png'

const auth = useAuthStore()
const modules = useModulesStore()
const router = useRouter()

function logout() {
  auth.logout()
  modules.reinitialiser()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <img :src="logo" alt="MACHIBEL" />
        <span>MACHIBEL</span>
      </div>

      <nav>
        <router-link to="/">Tableau de bord</router-link>
        <router-link to="/produits">Produits</router-link>
        <router-link v-if="modules.ventes" to="/vendeuses">Vendeuses</router-link>
        <router-link v-if="modules.ventes" to="/ventes">Ventes</router-link>
        <router-link to="/stock">Stock</router-link>
        <router-link v-if="modules.fournisseurs" to="/fournisseurs">Fournisseurs</router-link>
        <router-link v-if="modules.depenses" to="/depenses">Dépenses</router-link>
        <router-link to="/rapports">Rapports</router-link>
        <router-link to="/historique">Historique</router-link>
        <router-link to="/parametres">Paramètres</router-link>
      </nav>

      <div class="user-box">
        <div>{{ auth.user?.nom }}</div>
        <div style="opacity: 0.7">Administrateur</div>
        <button type="button" @click="logout">Deconnexion</button>
      </div>
    </aside>

    <main class="main-content">
      <slot />
    </main>
  </div>
</template>
