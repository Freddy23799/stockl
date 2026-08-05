import { defineStore } from 'pinia'

// -----------------------------------------------------------------------------
// Suivi des telechargements.
//
// Un rapport peut mettre plusieurs secondes a se construire sur un service qui
// sort de veille. Sans retour visible, l'utilisateur clique une deuxieme fois,
// puis une troisieme. L'indicateur repond a cette question : "est-ce que mon
// clic a fait quelque chose ?"
//
// Le fichier recu est conserve sous forme d'URL d'objet pour pouvoir etre
// rouvert depuis le panneau sans redemander le document au serveur. Ces URL
// retiennent le blob en memoire : elles sont donc explicitement liberees des
// qu'une entree quitte la liste.
// -----------------------------------------------------------------------------

let compteur = 0

// Au dela, les entrees les plus anciennes deja terminees sont evacuees : le
// panneau reste lisible et la memoire ne monte pas indefiniment.
const MAX_ENTREES = 12

// Delai avant que l'indicateur disparaisse une fois le dernier telechargement
// termine. Assez long pour laisser le temps d'ouvrir le fichier, assez court
// pour ne pas encombrer la barre en permanence.
const DELAI_MASQUAGE_MS = 25000

export const useTelechargementsStore = defineStore('telechargements', {
  state: () => ({
    elements: [],
    panneauOuvert: false,
    // Horodatage de la derniere fin de telechargement, pour le masquage differe.
    dernierAchevement: 0,
    maintenant: Date.now(),
  }),

  getters: {
    actifs: (state) => state.elements.filter((e) => e.statut === 'en_cours'),
    termines: (state) => state.elements.filter((e) => e.statut !== 'en_cours'),
    enEchec: (state) => state.elements.filter((e) => e.statut === 'echec'),

    // L'indicateur s'affiche pendant un telechargement, puis reste un moment
    // pour donner acces au fichier recu.
    visible(state) {
      if (state.panneauOuvert) return true
      if (state.elements.some((e) => e.statut === 'en_cours')) return true
      if (!state.elements.length) return false
      return state.maintenant - state.dernierAchevement < DELAI_MASQUAGE_MS
    },

    // Progression cumulee de ce qui est en cours. Les telechargements dont la
    // taille est inconnue sont comptes comme une part de poids egal, sinon un
    // seul document sans `Content-Length` figerait la barre entiere.
    progressionGlobale(state) {
      const actifs = state.elements.filter((e) => e.statut === 'en_cours')
      if (!actifs.length) return 100
      const somme = actifs.reduce((total, e) => total + (e.progression ?? 0), 0)
      return Math.round(somme / actifs.length)
    },

    // Vrai quand aucun des telechargements en cours ne connait sa taille : la
    // barre doit alors s'animer plutot que d'afficher un faux pourcentage.
    progressionIndeterminee(state) {
      const actifs = state.elements.filter((e) => e.statut === 'en_cours')
      return actifs.length > 0 && actifs.every((e) => e.progression === null)
    },
  },

  actions: {
    ajouter({ libelle, nomFichier, controleur = null }) {
      compteur += 1
      const id = `tel-${compteur}`
      this.elements.unshift({
        id,
        libelle,
        nomFichier,
        statut: 'en_cours',
        progression: null,
        recus: 0,
        total: null,
        taille: null,
        url: null,
        erreur: '',
        debut: Date.now(),
        controleur,
      })
      this.elaguer()
      return id
    },

    progresser(id, { recus, total }) {
      const element = this.elements.find((e) => e.id === id)
      if (!element || element.statut !== 'en_cours') return
      element.recus = recus
      element.total = total || null
      // `total` n'existe que si le serveur annonce un `Content-Length`. Sans
      // lui, on ne fabrique pas de pourcentage fantaisiste.
      element.progression = total ? Math.min(100, Math.round((recus / total) * 100)) : null
    },

    reussir(id, { url, taille, nomFichier }) {
      const element = this.elements.find((e) => e.id === id)
      if (!element) return
      element.statut = 'termine'
      element.progression = 100
      element.url = url
      element.taille = taille
      if (nomFichier) element.nomFichier = nomFichier
      element.controleur = null
      this.dernierAchevement = Date.now()
      this.maintenant = this.dernierAchevement
    },

    echouer(id, message) {
      const element = this.elements.find((e) => e.id === id)
      if (!element) return
      element.statut = 'echec'
      element.erreur = message || 'Le telechargement a echoue'
      element.controleur = null
      this.dernierAchevement = Date.now()
      this.maintenant = this.dernierAchevement
      // Un echec doit se voir : on ouvre le panneau plutot que d'attendre que
      // l'utilisateur devine qu'il s'est passe quelque chose.
      this.panneauOuvert = true
    },

    annuler(id) {
      const element = this.elements.find((e) => e.id === id)
      if (!element || element.statut !== 'en_cours') return
      element.controleur?.abort()
      element.statut = 'annule'
      element.controleur = null
      this.dernierAchevement = Date.now()
    },

    retirer(id) {
      const index = this.elements.findIndex((e) => e.id === id)
      if (index === -1) return
      const [element] = this.elements.splice(index, 1)
      element.controleur?.abort()
      this.libererUrl(element)
    },

    viderTermines() {
      const restants = []
      for (const element of this.elements) {
        if (element.statut === 'en_cours') restants.push(element)
        else this.libererUrl(element)
      }
      this.elements = restants
      if (!this.elements.length) this.panneauOuvert = false
    },

    // Les entrees terminees les plus anciennes partent en premier ; celles qui
    // sont encore en cours ne sont jamais evacuees.
    elaguer() {
      if (this.elements.length <= MAX_ENTREES) return
      for (let i = this.elements.length - 1; i >= 0 && this.elements.length > MAX_ENTREES; i -= 1) {
        if (this.elements[i].statut !== 'en_cours') {
          this.libererUrl(this.elements[i])
          this.elements.splice(i, 1)
        }
      }
    },

    libererUrl(element) {
      if (element?.url) {
        URL.revokeObjectURL(element.url)
        element.url = null
      }
    },

    basculerPanneau() {
      this.panneauOuvert = !this.panneauOuvert
    },

    fermerPanneau() {
      this.panneauOuvert = false
    },

    // Appele par une horloge dans le composant : le masquage differe depend du
    // temps qui passe, pas d'un evenement.
    rafraichir() {
      this.maintenant = Date.now()
    },
  },
})
