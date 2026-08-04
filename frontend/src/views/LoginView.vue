<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import logo from '../assets/branding/logo-machibel.png'

const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(email.value, password.value)
    router.push({ name: 'dashboard' })
  } catch (err) {
    error.value = err.response?.data?.message || 'Erreur de connexion'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="card login-card">
      <img :src="logo" alt="MACHIBEL" />
      <h1>MACHIBEL</h1>
      <p style="margin-bottom: 20px; opacity: 0.75">Gestion de la parfumerie</p>

      <form @submit.prevent="submit">
        <div class="form-row">
          <label for="email">Email</label>
          <input id="email" v-model="email" type="email" autocomplete="username" required />
        </div>
        <div class="form-row">
          <label for="password">Mot de passe</label>
          <input id="password" v-model="password" type="password" autocomplete="current-password" required />
        </div>

        <p v-if="error" class="error-message">{{ error }}</p>

        <button type="submit" class="primary" :disabled="loading">
          {{ loading ? 'Connexion...' : 'Se connecter' }}
        </button>
      </form>
    </div>
  </div>
</template>
