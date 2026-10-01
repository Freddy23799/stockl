<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useModulesStore } from '../stores/modules'
import { useThemeStore } from '../stores/theme'
import { useNotificationsStore } from '../stores/notifications'
import api from '../api/client'
import Icon from './ui/Icon.vue'
import Modal from './ui/Modal.vue'
import EmptyState from './ui/EmptyState.vue'
import TelechargementIndicateur from './ui/TelechargementIndicateur.vue'
import logo from '../assets/branding/logo-machibel.png'

const auth = useAuthStore()
const modules = useModulesStore()
const theme = useThemeStore()
const notifications = useNotificationsStore()
const router = useRouter()
const route = useRoute()

const menuOuvert = ref(false)

const ROLE_LABELS = {
  admin: 'Administrateur',
  vendeuse: 'Vendeuse',
  comptabilite: 'Comptabilite',
  gestionnaire_stock: 'Gestionnaire de stock',
  operateur: 'Operateur plateforme',
}
const roleLabel = computed(() => ROLE_LABELS[auth.user?.role] || '')

// Cloche de notifications : seuls admin et gestionnaire de stock sont
// concernes par le reapprovisionnement (voir routes/notifications.routes.js
// cote backend, qui applique la meme restriction).
const voitNotifications = computed(() => auth.hasRole('gestionnaire_stock'))
const notifOuvert = ref(false)
let intervalleNotifications = null

async function ouvrirNotifications() {
  notifOuvert.value = true
  await notifications.charger()
}

async function marquerToutLu() {
  await notifications.marquerToutLu()
}

// Pastille de stock bas dans la navigation : l'alerte doit se voir depuis
// n'importe quelle page, pas seulement en ouvrant Stock.
const alertes = ref(0)

async function chargerAlertes() {
  if (auth.user?.role === 'operateur') return
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
// Chaque item est filtre par module ACTIF ET par role : un admin voit tout
// (auth.hasRole() renvoie toujours vrai pour lui), les roles restreints ne
// voient que leur perimetre. Le backend applique le meme perimetre route par
// route - ce filtrage n'est qu'un confort d'affichage, pas la securite reelle.
//
// L'operateur plateforme est hors de ce modele : il ne gere aucune boutique,
// donc rien de ce qui suit (produits, stock, ventes...) ne le concerne. Cas a
// part plutot que d'ajouter une exclusion sur chaque ligne ci-dessous.
const sections = computed(() => {
  if (auth.user?.role === 'operateur') {
    return [{ titre: 'Plateforme', items: [{ to: '/entreprises', label: 'Entreprises', icon: 'building' }] }]
  }
  return [
  {
    titre: 'Pilotage',
    items: [
      ...(auth.hasRole('comptabilite') ? [{ to: '/', label: 'Tableau de bord', icon: 'dashboard' }] : []),
      ...(auth.hasRole('comptabilite') ? [{ to: '/rapports', label: 'Rapports', icon: 'chart' }] : []),
    ],
  },
  {
    titre: 'Activite',
    items: [
      ...(auth.hasRole('direction', 'comptabilite', 'secretaire', 'responsable_commercial', 'commercial', 'support') ? [{ to: '/clients', label: 'Clients', icon: 'users' }] : []),
      ...(auth.hasRole('direction', 'responsable_commercial', 'commercial') ? [{ to: '/devis', label: 'Devis et commandes', icon: 'receipt' }] : []),
      ...(auth.hasRole('direction', 'manager', 'gestionnaire_stock', 'comptabilite', 'responsable_rh', 'employe') ? [{ to: '/approbations', label: 'Approbations', icon: 'check' }] : []),
      ...(modules.ventes && auth.hasRole('vendeuse', 'comptabilite', 'gestionnaire_stock')
        ? [{ to: '/ventes', label: 'Ventes', icon: 'cart' }] : []),
      ...(modules.depenses && auth.hasRole('comptabilite') ? [{ to: '/depenses', label: 'Depenses', icon: 'receipt' }] : []),
    ],
  },
  {
    titre: 'Catalogue & stock',
    items: [
      { to: '/produits', label: 'Produits', icon: 'package' },
      { to: '/stock', label: 'Stock', icon: 'layers', badge: alertes.value || null },
      ...(modules.fournisseurs && auth.hasRole('gestionnaire_stock') ? [{ to: '/fournisseurs', label: 'Fournisseurs', icon: 'truck' }] : []),
    ],
  },
  {
    titre: 'Personnel',
    items: [
      ...(modules.employes && auth.isAdmin ? [{ to: '/employes', label: 'Employes', icon: 'idCard' }] : []),
      ...(modules.paie && auth.hasRole('comptabilite') ? [{ to: '/paie', label: 'Paie', icon: 'wallet' }] : []),
      ...(modules.ventes && auth.isAdmin ? [{ to: '/vendeuses', label: 'Vendeuses', icon: 'users' }] : []),
    ],
  },
  {
    titre: 'Administration',
    items: [
      ...(auth.isAdmin ? [{ to: '/historique', label: 'Historique', icon: 'history' }] : []),
      ...(auth.isAdmin ? [{ to: '/roles', label: 'Roles et permissions', icon: 'shield' }] : []),
      ...(auth.isAdmin ? [{ to: '/parametres', label: 'Parametres', icon: 'settings' }] : []),
    ],
  },
  ].filter((s) => s.items.length)
})

// Navigation basse : quatre destinations maximum, choisies pour l'usage
// quotidien en boutique. Le reste passe par le menu lateral.
const navBasse = computed(() => {
  if (auth.user?.role === 'operateur') {
    return [{ to: '/entreprises', label: 'Entreprises', icon: 'building' }]
  }
  return [
    ...(auth.hasRole('comptabilite') ? [{ to: '/', label: 'Accueil', icon: 'dashboard' }] : []),
    ...(modules.ventes && auth.hasRole('vendeuse', 'comptabilite', 'gestionnaire_stock')
      ? [{ to: '/ventes', label: 'Ventes', icon: 'cart' }] : []),
    { to: '/stock', label: 'Stock', icon: 'layers', badge: alertes.value || null },
    { to: '/produits', label: 'Produits', icon: 'package' },
  ]
})

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
  notifications.reinitialiser()
  router.push({ name: 'login' })
}

// Le menu mobile se referme des qu'on change de page, sinon il masque la page
// qu'on vient d'ouvrir.
watch(() => route.path, () => { menuOuvert.value = false })

onMounted(() => {
  chargerAlertes()
  if (voitNotifications.value) {
    notifications.chargerCompte()
    intervalleNotifications = setInterval(() => notifications.chargerCompte(), 30000)
  }
})
onBeforeUnmount(() => {
  if (intervalleNotifications) clearInterval(intervalleNotifications)
})
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
            <span class="user-chip-role">{{ roleLabel }}</span>
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
          v-if="voitNotifications"
          type="button"
          class="icon-btn"
          title="Notifications"
          @click="ouvrirNotifications"
        >
          <Icon name="bell" :size="17" />
          <span v-if="notifications.nonLues" class="nav-link-badge icon-btn-badge">{{ notifications.nonLues }}</span>
        </button>
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

    <Modal v-if="notifOuvert" title="Notifications" @close="notifOuvert = false">
      <EmptyState
        v-if="!notifications.chargement && !notifications.items.length"
        icon="bell"
        title="Aucune notification"
        desc="Les alertes de stock bas apparaitront ici."
      />
      <ul v-else class="notif-list">
        <li v-for="n in notifications.items" :key="n.id" class="notif-item" :class="{ 'is-non-lue': !n.lu }">
          <span class="notif-item-titre">{{ n.titre }}</span>
          <span class="notif-item-message">{{ n.message }}</span>
          <button v-if="!n.lu" type="button" class="btn btn-ghost btn-sm" @click="notifications.marquerLue(n.id)">
            Marquer comme lue
          </button>
        </li>
      </ul>
      <template #footer>
        <button type="button" class="btn" @click="marquerToutLu">Tout marquer comme lu</button>
      </template>
    </Modal>

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
