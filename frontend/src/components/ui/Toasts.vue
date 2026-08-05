<script setup>
import { useToastStore } from '../../stores/toasts'
import Icon from './Icon.vue'

const toasts = useToastStore()

const ICONES = { success: 'check', error: 'alert', info: 'info' }
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts.items" :key="t.id" class="toast" :class="t.type">
        <Icon :name="ICONES[t.type] || 'info'" :size="17" />
        <div class="toast-body">{{ t.message }}</div>
        <button type="button" class="toast-close" aria-label="Fermer" @click="toasts.retirer(t.id)">
          <Icon name="x" :size="15" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
