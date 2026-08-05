import { defineStore } from 'pinia'

// Notifications ephemeres. Remplacent les paragraphes d'erreur qui restaient
// affiches indefiniment en bas des formulaires : un retour d'action doit se
// voir immediatement puis disparaitre.
let compteur = 0

export const useToastStore = defineStore('toasts', {
  state: () => ({ items: [] }),
  actions: {
    pousser(message, type = 'info', duree = 4000) {
      const id = ++compteur
      this.items.push({ id, message, type })
      if (duree > 0) setTimeout(() => this.retirer(id), duree)
      return id
    },
    succes(message) { return this.pousser(message, 'success') },
    // Les erreurs restent plus longtemps : on doit avoir le temps de les lire.
    erreur(message) { return this.pousser(message, 'error', 7000) },
    info(message) { return this.pousser(message, 'info') },
    retirer(id) {
      const i = this.items.findIndex((t) => t.id === id)
      if (i !== -1) this.items.splice(i, 1)
    },
  },
})
