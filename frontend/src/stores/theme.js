import { defineStore } from 'pinia'

const CLE = 'machibel-theme'

// Theme clair / sombre. Le choix explicite de l'utilisateur est memorise ;
// sans choix, on suit la preference du systeme.
function themeInitial() {
  const enregistre = localStorage.getItem(CLE)
  if (enregistre === 'light' || enregistre === 'dark') return enregistre
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useThemeStore = defineStore('theme', {
  state: () => ({ theme: themeInitial() }),
  actions: {
    appliquer() {
      document.documentElement.setAttribute('data-theme', this.theme)
    },
    basculer() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(CLE, this.theme)
      this.appliquer()
    },
  },
})
