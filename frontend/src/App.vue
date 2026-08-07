<script setup>
import { useRoute } from 'vue-router'
import AppLayout from './components/AppLayout.vue'
import Toasts from './components/ui/Toasts.vue'
import BandeauMiseAJour from './components/ui/BandeauMiseAJour.vue'

const route = useRoute()
</script>

<template>
  <AppLayout v-if="route.meta.requiresAuth">
    <router-view />
  </AppLayout>
  <router-view v-else />

  <Toasts />
  <BandeauMiseAJour />
</template>
