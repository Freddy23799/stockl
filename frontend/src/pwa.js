import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

// Mise a jour de l'application installee sur le telephone.
//
// Le probleme resolu ici : une fois le PWA installe, le navigateur sert la page
// depuis le cache du service worker. Il ne redemande `sw.js` au serveur qu'au
// chargement de la page - or un PWA sur telephone n'est jamais vraiment ferme,
// on le laisse en arriere-plan et on y revient. Sans verification explicite, la
// version installee pouvait rester en place indefiniment alors que le serveur
// en servait une plus recente depuis des jours.
//
// Deux corrections, et pas seulement la premiere :
//   1. on interroge le serveur au retour dans l'application et toutes les
//      quinze minutes, au lieu d'attendre un hypothetique rechargement ;
//   2. la nouvelle version s'installe mais N'ECRASE PAS la page en cours. Elle
//      attend que l'utilisateur l'accepte : une caisse ne doit pas se recharger
//      d'elle-meme au milieu d'une vente a moitie saisie.

export const nouvelleVersion = ref(false)

const INTERVALLE_VERIFICATION = 15 * 60 * 1000

let appliquer = null

export function demarrerMisesAJour() {
  appliquer = registerSW({
    immediate: true,

    onNeedRefresh() {
      nouvelleVersion.value = true
    },

    onRegisteredSW(url, registration) {
      if (!registration) return

      const verifier = () => {
        // Inutile d'insister hors ligne : l'appel echouerait et le prochain
        // retour au premier plan reessaiera de toute facon.
        if (navigator.onLine === false) return
        registration.update().catch(() => {})
      }

      setInterval(verifier, INTERVALLE_VERIFICATION)

      // Le declencheur qui compte sur telephone : rouvrir l'application depuis
      // le selecteur de taches ne recharge pas la page, mais repasse bien par
      // cet evenement.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') verifier()
      })

      window.addEventListener('online', verifier)
    },
  })
}

// `true` : le service worker en attente prend la main et la page se recharge.
export function appliquerMiseAJour() {
  nouvelleVersion.value = false
  if (appliquer) appliquer(true)
}
