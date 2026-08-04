import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3010/api',
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

const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:3010/api').replace(/\/api\/?$/, '')

export function assetUrl(path) {
  if (!path) return null
  return `${API_ROOT}/${path.replace(/^\/+/, '')}`
}

export default api
