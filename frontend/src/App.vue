<script setup>
import { useRoute } from 'vue-router'
import AppLayout from './components/AppLayout.vue'
import Toasts from './components/ui/Toasts.vue'

const route = useRoute()
</script>

<template>
  <AppLayout v-if="route.meta.requiresAuth">
    <router-view />
  </AppLayout>
  <router-view v-else />

  <Toasts />
</template>
