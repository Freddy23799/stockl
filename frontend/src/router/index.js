import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useModulesStore } from '../stores/modules'

// `meta.module` rattache une route a un module desactivable : si ce module
// est eteint, la route est totalement inaccessible (redirection), meme par
// URL directe.
//
// `meta.roles` restreint une route a une liste de roles (un admin garde
// toujours acces, voir auth.hasRole) : sans mention, la route reste ouverte a
// tout compte authentifie (cas de Produits et Stock, dont la lecture est
// ouverte a tous les roles cote backend).
const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { requiresAuth: true, roles: ['admin', 'comptabilite'] } },
  { path: '/produits', name: 'produits', component: () => import('../views/ProduitsView.vue'), meta: { requiresAuth: true } },
  { path: '/vendeuses', name: 'vendeuses', component: () => import('../views/VendeusesView.vue'), meta: { requiresAuth: true, module: 'ventes', roles: ['admin'] } },
  { path: '/ventes', name: 'ventes', component: () => import('../views/VentesView.vue'), meta: { requiresAuth: true, module: 'ventes', roles: ['admin', 'vendeuse', 'comptabilite', 'gestionnaire_stock'] } },
  { path: '/stock', name: 'stock', component: () => import('../views/StockView.vue'), meta: { requiresAuth: true } },
  { path: '/fournisseurs', name: 'fournisseurs', component: () => import('../views/FournisseursView.vue'), meta: { requiresAuth: true, module: 'fournisseurs', roles: ['admin', 'gestionnaire_stock'] } },
  { path: '/depenses', name: 'depenses', component: () => import('../views/DepensesView.vue'), meta: { requiresAuth: true, module: 'depenses', roles: ['admin', 'comptabilite'] } },
  { path: '/employes', name: 'employes', component: () => import('../views/EmployesView.vue'), meta: { requiresAuth: true, module: 'employes', roles: ['admin'] } },
  { path: '/employes/:id', name: 'employe-detail', component: () => import('../views/EmployeDetailView.vue'), meta: { requiresAuth: true, module: 'employes', roles: ['admin'] } },
  { path: '/paie', name: 'paie', component: () => import('../views/PaieView.vue'), meta: { requiresAuth: true, module: 'paie', roles: ['admin', 'comptabilite'] } },
  { path: '/paie/cycles/:id', name: 'paie-cycle', component: () => import('../views/PaieCycleView.vue'), meta: { requiresAuth: true, module: 'paie', roles: ['admin', 'comptabilite'] } },
  { path: '/rapports', name: 'rapports', component: () => import('../views/RapportsView.vue'), meta: { requiresAuth: true, roles: ['admin', 'comptabilite'] } },
  { path: '/parametres', name: 'parametres', component: () => import('../views/ParametresView.vue'), meta: { requiresAuth: true, roles: ['admin'] } },
  { path: '/historique', name: 'historique', component: () => import('../views/HistoriqueView.vue'), meta: { requiresAuth: true, roles: ['admin'] } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Destination de secours quand la route demandee est hors du perimetre du
// role connecte (navigation manuelle, lien externe, ancien favori...). Chaque
// role restreint a au moins une page qui lui est ouverte ; l'admin n'est
// jamais concerne, `hasRole` lui donnant toujours acces.
const ACCUEIL_PAR_ROLE = {
  vendeuse: 'ventes',
  gestionnaire_stock: 'stock',
  comptabilite: 'depenses',
}

function accueilPourRole(role) {
  return { name: ACCUEIL_PAR_ROLE[role] || 'dashboard' }
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const modules = useModulesStore()

  if (!auth.initialized) {
    await auth.restoreSession()
  }

  if (to.name === 'login' && auth.isAuthenticated) {
    return accueilPourRole(auth.user?.role)
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' }
  }

  if (auth.isAuthenticated && !modules.charge) {
    await modules.charger()
  }

  if (to.meta.roles && !auth.hasRole(...to.meta.roles)) {
    return accueilPourRole(auth.user?.role)
  }
  if (to.meta.module && !modules[to.meta.module]) {
    return accueilPourRole(auth.user?.role)
  }
})

export default router
