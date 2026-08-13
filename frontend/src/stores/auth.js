import { defineStore } from 'pinia'
import api from '../api/client'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || null,
    user: null,
    initialized: false,
  }),
  getters: {
    isAuthenticated: (state) => !!state.token && !!state.user,
    isAdmin: (state) => state.user?.role === 'admin',
    isVendeuse: (state) => state.user?.role === 'vendeuse',
    isComptabilite: (state) => state.user?.role === 'comptabilite',
    isGestionnaireStock: (state) => state.user?.role === 'gestionnaire_stock',
    // Utilise pour les gardes de navigation : `auth.hasRole('admin', 'comptabilite')`.
    // Un admin garde toujours acces a tout, meme a une liste qui ne le nomme
    // pas explicitement - c'est le compte qui, par definition, voit tout.
    hasRole: (state) => (...roles) => state.user?.role === 'admin' || roles.includes(state.user?.role),
  },
  actions: {
    setSession(token, user) {
      this.token = token
      this.user = user
      localStorage.setItem('token', token)
    },
    async login(identifiant, password) {
      const { data } = await api.post('/auth/login', { identifiant, password })
      this.setSession(data.token, data.user)
    },
    async restoreSession() {
      if (!this.token) {
        this.initialized = true
        return
      }
      try {
        const { data } = await api.get('/auth/me')
        this.user = data
      } catch {
        this.logout()
      } finally {
        this.initialized = true
      }
    },
    logout() {
      this.token = null
      this.user = null
      localStorage.removeItem('token')
    },
  },
})
