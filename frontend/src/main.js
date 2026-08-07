import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'
import { useThemeStore } from './stores/theme'
import { demarrerMisesAJour } from './pwa'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// Le theme est pose sur <html> avant le montage : sinon la page s'affiche une
// fraction de seconde en clair avant de basculer en sombre.
useThemeStore(pinia).appliquer()

app.use(router)
app.mount('#app')

// Apres le montage : la verification des mises a jour ne doit pas retarder le
// premier affichage.
demarrerMisesAJour()
