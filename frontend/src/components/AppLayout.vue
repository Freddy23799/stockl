<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useModulesStore } from '../stores/modules'
import { useThemeStore } from '../stores/theme'
import api from '../api/client'
import Icon from './ui/Icon.vue'
import TelechargementIndicateur from './ui/TelechargementIndicateur.vue'
import logo from '../assets/branding/logo-machibel.png'

const auth = useAuthStore()
const modules = useModulesStore()
const theme = useThemeStore()
const router = useRouter()
const route = useRoute()

const menuOuvert = ref(false)

// Pastille de stock bas dans la navigation : l'alerte doit se voir depuis
// n'importe quelle page, pas seulement en ouvrant Stock.
const alertes = ref(0)

async function chargerAlertes() {
  try {
    const { data } = await api.get('/stock/alertes')
    alertes.value = data.length
  } catch {
    alertes.value = 0
  }
}

// Navigation groupee par intention plutot qu'une liste plate : on cherche
// "ou j'enregistre une vente" ou "ou je consulte mes chiffres", pas un item
// precis dans une liste de dix.
const sections = computed(() => [
  {
    titre: 'Pilotage',
    items: [
      { to: '/', label: 'Tableau de bord', icon: 'dashboard' },
      { to: '/rapports', label: 'Rapports', icon: 'chart' },
    ],
  },
  {
    titre: 'Activite',
    items: [
      ...(modules.ventes ? [{ to: '/ventes', label: 'Ventes', icon: 'cart' }] : []),
      ...(modules.depenses ? [{ to: '/depenses', label: 'Depenses', icon: 'receipt' }] : []),
    ],
  },
  {
    titre: 'Catalogue & stock',
    items: [
      { to: '/produits', label: 'Produits', icon: 'package' },
      { to: '/stock', label: 'Stock', icon: 'layers', badge: alertes.value || null },
      ...(modules.fournisseurs ? [{ to: '/fournisseurs', label: 'Fournisseurs', icon: 'truck' }] : []),
    ],
  },
  {
    titre: 'Administration',
    items: [
      ...(modules.ventes ? [{ to: '/vendeuses', label: 'Vendeuses', icon: 'users' }] : []),
      { to: '/historique', label: 'Historique', icon: 'history' },
      { to: '/parametres', label: 'Parametres', icon: 'settings' },
    ],
  },
].filter((s) => s.items.length))

// Navigation basse : quatre destinations maximum, choisies pour l'usage
// quotidien en boutique. Le reste passe par le menu lateral.
const navBasse = computed(() => [
  { to: '/', label: 'Accueil', icon: 'dashboard' },
  ...(modules.ventes ? [{ to: '/ventes', label: 'Ventes', icon: 'cart' }] : []),
  { to: '/stock', label: 'Stock', icon: 'layers', badge: alertes.value || null },
  { to: '/produits', label: 'Produits', icon: 'package' },
])

const titreCourant = computed(() => {
  for (const s of sections.value) {
    const item = s.items.find((i) => i.to === route.path)
    if (item) return item.label
  }
  return ''
})

const initiales = computed(() => {
  const u = auth.user
  if (!u) return '?'
  const p = (u.prenom || '').trim()
  const n = (u.nom || '').trim()
  if (p && n) return (p[0] + n[0])
  return (u.nom_utilisateur || '?').slice(0, 2)
})

const nomComplet = computed(() => {
  const u = auth.user
  if (!u) return ''
  return [u.prenom, u.nom].filter(Boolean).join(' ') || u.nom_utilisateur
})

function deconnexion() {
  auth.logout()
  modules.reinitialiser()
  router.push({ name: 'login' })
}

// Le menu mobile se referme des qu'on change de page, sinon il masque la page
// qu'on vient d'ouvrir.
watch(() => route.path, () => { menuOuvert.value = false })

onMounted(chargerAlertes)
watch(() => route.path, (p) => { if (p === '/stock' || p === '/produits') chargerAlertes() })
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ 'is-open': menuOuvert }">
      <div class="sidebar-brand">
        <img :src="logo" alt="" />
        <span class="sidebar-brand-text">
          <span class="sidebar-brand-name">MACHIBEL</span>
          <span class="sidebar-brand-sub">Gestion parfumerie</span>
        </span>
      </div>

      <nav class="sidebar-nav">
        <template v-for="s in sections" :key="s.titre">
          <div class="nav-section">{{ s.titre }}</div>
          <router-link v-for="i in s.items" :key="i.to" :to="i.to" class="nav-link">
            <Icon :name="i.icon" :size="17" />
            {{ i.label }}
            <span v-if="i.badge" class="nav-link-badge">{{ i.badge }}</span>
          </router-link>
        </template>
      </nav>

      <div class="sidebar-footer">
        <div class="user-chip" style="cursor: default">
          <span class="avatar">{{ initiales }}</span>
          <span class="user-chip-info">
            <span class="user-chip-name">{{ nomComplet }}</span>
            <span class="user-chip-role">Administrateur</span>
          </span>
          <button type="button" class="icon-btn" title="Se deconnecter" @click="deconnexion">
            <Icon name="logout" :size="16" />
          </button>
        </div>
      </div>
    </aside>

    <div v-if="menuOuvert" class="scrim" @click="menuOuvert = false" />

    <div class="app-main">
      <header class="topbar">
        <button type="button" class="icon-btn burger" aria-label="Menu" @click="menuOuvert = !menuOuvert">
          <Icon name="menu" :size="19" />
        </button>
        <span class="topbar-title">{{ titreCourant }}</span>
        <div class="topbar-spacer" />
        <TelechargementIndicateur />
        <button
          type="button"
          class="icon-btn"
          :title="theme.theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'"
          @click="theme.basculer()"
        >
          <Icon :name="theme.theme === 'dark' ? 'sun' : 'moon'" :size="17" />
        </button>
      </header>

      <main class="page">
        <slot />
      </main>
    </div>

    <!-- Navigation basse : visible uniquement sur telephone (voir style.css) -->
    <nav class="bottom-nav">
      <router-link v-for="i in navBasse" :key="i.to" :to="i.to" class="bottom-nav-link">
        <Icon :name="i.icon" :size="20" />
        <span>{{ i.label }}</span>
        <span v-if="i.badge" class="bottom-nav-pastille">{{ i.badge }}</span>
      </router-link>
    </nav>
  </div>
</template>
