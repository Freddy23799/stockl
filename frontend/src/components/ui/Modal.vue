<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  title: { type: String, default: '' },
  size: { type: String, default: 'md' },
})
const emit = defineEmits(['close'])

// Echap ferme la modale, et le defilement de la page est bloque tant qu'elle
// est ouverte (sinon on fait defiler l'arriere-plan en scrollant le formulaire).
function surTouche(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', surTouche)
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', surTouche)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal" :class="{ 'modal-lg': size === 'lg' }" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>{{ title }}</h2>
        <button type="button" class="icon-btn" aria-label="Fermer" @click="emit('close')">
          <Icon name="x" :size="17" />
        </button>
      </div>
      <div class="modal-body"><slot /></div>
      <div v-if="$slots.footer" class="modal-foot"><slot name="footer" /></div>
    </div>
  </div>
</template>
