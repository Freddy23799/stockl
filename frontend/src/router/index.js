import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useModulesStore } from '../stores/modules'

// Seuls des comptes Administrateur existent (les vendeuses ne sont pas des
// utilisateurs) : toute route protegee est donc de facto reservee a l'admin.
// `meta.module` rattache une route a un module desactivable : si ce module
// est eteint, la route est totalement inaccessible (redirection), meme par
// URL directe.
const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { requiresAuth: true } },
  { path: '/produits', name: 'produits', component: () => import('../views/ProduitsView.vue'), meta: { requiresAuth: true } },
  { path: '/vendeuses', name: 'vendeuses', component: () => import('../views/VendeusesView.vue'), meta: { requiresAuth: true, module: 'ventes' } },
  { path: '/ventes', name: 'ventes', component: () => import('../views/VentesView.vue'), meta: { requiresAuth: true, module: 'ventes' } },
  { path: '/stock', name: 'stock', component: () => import('../views/StockView.vue'), meta: { requiresAuth: true } },
  { path: '/fournisseurs', name: 'fournisseurs', component: () => import('../views/FournisseursView.vue'), meta: { requiresAuth: true, module: 'fournisseurs' } },
  { path: '/depenses', name: 'depenses', component: () => import('../views/DepensesView.vue'), meta: { requiresAuth: true, module: 'depenses' } },
  { path: '/rapports', name: 'rapports', component: () => import('../views/RapportsView.vue'), meta: { requiresAuth: true } },
  { path: '/parametres', name: 'parametres', component: () => import('../views/ParametresView.vue'), meta: { requiresAuth: true } },
  { path: '/historique', name: 'historique', component: () => import('../views/HistoriqueView.vue'), meta: { requiresAuth: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const modules = useModulesStore()

  if (!auth.initialized) {
    await auth.restoreSession()
  }

  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'dashboard' }
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' }
  }

  if (auth.isAuthenticated && !modules.charge) {
    await modules.charger()
  }

  if (to.meta.module && !modules[to.meta.module]) {
    return { name: 'dashboard' }
  }
})

export default router
