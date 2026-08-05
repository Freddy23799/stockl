import axios from 'axios'

// Aucune variable a definir pour un build de production : c'est le backend
// lui-meme qui sert la PWA, donc l'API est sur la meme origine et '/api' en
// chemin relatif suffit — quel que soit le domaine.
// En dev, Vite tourne sur 5174 et le backend sur 3010 : origines differentes,
// il faut l'URL absolue.
// VITE_API_URL ne sert qu'au cas ou le backend serait ailleurs.
const API_BASE =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3010/api' : '/api')

const api = axios.create({
  baseURL: API_BASE,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config.url.includes('/auth/login')) {
      localStorage.removeItem('token')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// Racine du serveur de fichiers (photos produits, logo) : la meme URL sans /api.
// En production cela donne '' -> les images sont chargees en relatif.
const API_ROOT = API_BASE.replace(/\/api\/?$/, '')

export function assetUrl(path) {
  if (!path) return null
  return `${API_ROOT}/${path.replace(/^\/+/, '')}`
}

export default api
