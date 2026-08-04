<script setup>
defineProps({ title: { type: String, default: '' } })
const emit = defineEmits(['close'])
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-box card">
      <div class="modal-header">
        <h2>{{ title }}</h2>
        <button type="button" class="modal-close" @click="emit('close')">×</button>
      </div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 50;
}
.modal-box {
  width: 100%;
  max-width: 520px;
  max-height: 85vh;
  overflow-y: auto;
  margin: 0;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-close {
  border: none;
  background: none;
  font-size: 20px;
  line-height: 1;
  padding: 4px 8px;
}
</style>
