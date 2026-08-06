import { defineStore } from 'pinia'
import api from '../api/client'

// Reflete les interrupteurs de modules configures par l'admin (Parametres).
// Charge une fois au demarrage / apres connexion, puis rafraichi immediatement
// apres tout changement dans ParametresView pour que toute l'interface se
// reorganise sans avoir besoin de recharger la page.
//
// La liste est declaree une seule fois. Auparavant chaque module etait ecrit a
// trois endroits, et en ajouter un demandait de ne pas en oublier : c'est le
// genre d'oubli qui laisse un module allume dans le menu apres l'avoir eteint.
const MODULES = ['ventes', 'fournisseurs', 'depenses', 'employes', 'paie', 'badges']

function tousActifs() {
  return Object.fromEntries(MODULES.map((m) => [m, true]))
}

export const useModulesStore = defineStore('modules', {
  state: () => ({
    ...tousActifs(),
    chargement: false,
    charge: false,
  }),
  actions: {
    async charger() {
      this.chargement = true
      try {
        const { data } = await api.get('/parametres')
        for (const module of MODULES) {
          // Un module absent de la reponse (base pas encore migree) reste actif :
          // mieux vaut une page qui repond 403 qu'une application amputee sans
          // explication.
          this[module] = data[`module_${module}`] ?? true
        }
        this.charge = true
      } finally {
        this.chargement = false
      }
    },
    reinitialiser() {
      Object.assign(this, tousActifs())
      this.charge = false
    },
  },
})

export { MODULES }
