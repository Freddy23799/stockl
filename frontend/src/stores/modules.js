import { defineStore } from 'pinia'
import api from '../api/client'

// Reflete les interrupteurs de modules configures par l'admin (Parametres).
// Charge une fois au demarrage / apres connexion, puis rafraichi immediatement
// apres tout changement dans ParametresView pour que toute l'interface se
// reorganise sans avoir besoin de recharger la page.
export const useModulesStore = defineStore('modules', {
  state: () => ({
    ventes: true,
    fournisseurs: true,
    depenses: true,
    chargement: false,
    charge: false,
  }),
  actions: {
    async charger() {
      this.chargement = true
      try {
        const { data } = await api.get('/parametres')
        this.ventes = data.module_ventes
        this.fournisseurs = data.module_fournisseurs
        this.depenses = data.module_depenses
        this.charge = true
      } finally {
        this.chargement = false
      }
    },
    reinitialiser() {
      this.ventes = true
      this.fournisseurs = true
      this.depenses = true
      this.charge = false
    },
  },
})
