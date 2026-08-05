<script setup>
import Modal from './Modal.vue'
import Icon from './Icon.vue'

// Remplace window.confirm(), qui ne peut pas etre style, bloque le fil
// d'execution et affiche l'URL du site dans certains navigateurs.
defineProps({
  title: { type: String, required: true },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Confirmer' },
  tone: { type: String, default: 'danger' },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <Modal :title="title" @close="emit('cancel')">
    <div class="row" style="align-items: flex-start; gap: 12px">
      <span class="stat-icon" :class="`is-${tone}`" style="width: 34px; height: 34px">
        <Icon :name="tone === 'danger' ? 'warning' : 'info'" :size="17" />
      </span>
      <p class="flex-1">{{ message }}</p>
    </div>
    <template #footer>
      <button type="button" @click="emit('cancel')">Annuler</button>
      <button
        type="button"
        :class="tone === 'danger' ? 'btn-danger-solid' : 'primary'"
        :disabled="busy"
        @click="emit('confirm')"
      >
        <span v-if="busy" class="spinner" />
        {{ confirmLabel }}
      </button>
    </template>
  </Modal>
</template>
