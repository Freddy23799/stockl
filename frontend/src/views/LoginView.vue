<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import Icon from '../components/ui/Icon.vue'
import logo from '../assets/branding/logo-machibel.png'

const auth = useAuthStore()
const router = useRouter()

const identifiant = ref('')
const password = ref('')
const voirMotDePasse = ref(false)
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  loading.value = true
  try {
    // L'identifiant est normalise cote serveur, mais on retire les espaces
    // ici : ils viennent souvent d'un copier-coller et le message d'erreur
    // serait incomprehensible.
    await auth.login(identifiant.value.trim(), password.value)
    router.push({ name: 'dashboard' })
  } catch (err) {
    error.value = err.response?.data?.message
      || 'Connexion impossible. Verifiez votre identifiant et votre mot de passe.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <img :src="logo" alt="" />
        <h1>MACHIBEL</h1>
        <p>Gestion des ventes, du stock et des depenses</p>
      </div>

      <form @submit.prevent="submit">
        <div class="field">
          <label for="identifiant">Identifiant</label>
          <input
            id="identifiant"
            v-model="identifiant"
            type="text"
            autocomplete="username"
            placeholder="prenom.nom"
            autofocus
            required
          />
        </div>

        <div class="field">
          <label for="password">Mot de passe</label>
          <div style="position: relative">
            <input
              id="password"
              v-model="password"
              :type="voirMotDePasse ? 'text' : 'password'"
              autocomplete="current-password"
              required
              style="padding-right: 40px"
            />
            <button
              type="button"
              class="icon-btn"
              style="position: absolute; right: 3px; top: 50%; transform: translateY(-50%)"
              :aria-label="voirMotDePasse ? 'Masquer le mot de passe' : 'Afficher le mot de passe'"
              @click="voirMotDePasse = !voirMotDePasse"
            >
              <Icon name="eye" :size="16" />
            </button>
          </div>
        </div>

        <p v-if="error" class="alert alert-danger">
          <Icon name="alert" :size="16" />
          <span>{{ error }}</span>
        </p>

        <button type="submit" class="primary btn-block" :disabled="loading">
          <span v-if="loading" class="spinner" />
          {{ loading ? 'Connexion...' : 'Se connecter' }}
        </button>
      </form>
    </div>
  </div>
</template>
