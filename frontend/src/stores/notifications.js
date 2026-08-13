import { defineStore } from 'pinia'
import api from '../api/client'

// Cloche de notifications (stock bas pour l'instant). Etat de lecture
// PARTAGE cote backend (voir migration 021) : marquer comme lue la marque
// lue pour tout le monde, pas seulement pour le compte qui a clique.
export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    items: [],
    nonLues: 0,
    chargement: false,
  }),
  actions: {
    async charger() {
      this.chargement = true
      try {
        const { data } = await api.get('/notifications', { params: { pageSize: 20 } })
        this.items = data.data
      } finally {
        this.chargement = false
      }
    },
    async chargerCompte() {
      const { data } = await api.get('/notifications/compte-non-lues')
      this.nonLues = data.total
    },
    async marquerLue(id) {
      await api.patch(`/notifications/${id}/lu`)
      const item = this.items.find((n) => n.id === id)
      if (item) item.lu = true
      this.nonLues = Math.max(0, this.nonLues - 1)
    },
    async marquerToutLu() {
      await api.patch('/notifications/lu-tout')
      this.items.forEach((n) => { n.lu = true })
      this.nonLues = 0
    },
    reinitialiser() {
      this.items = []
      this.nonLues = 0
    },
  },
})
