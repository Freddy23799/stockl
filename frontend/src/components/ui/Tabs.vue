<script setup>
import Icon from './Icon.vue'

// Onglets pilotes par v-model. Chaque onglet : { id, label, icon?, count? }
// Le compteur n'apparait que s'il est fourni (0 compris : "0 alerte" est une
// information utile, pas une absence d'information).
defineProps({
  tabs: { type: Array, required: true },
  modelValue: { type: String, required: true },
})
defineEmits(['update:modelValue'])
</script>

<template>
  <div class="tabs" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.id"
      type="button"
      role="tab"
      :aria-selected="modelValue === t.id"
      class="tab"
      :class="{ 'is-active': modelValue === t.id }"
      @click="$emit('update:modelValue', t.id)"
    >
      <Icon v-if="t.icon" :name="t.icon" :size="15" />
      {{ t.label }}
      <span v-if="t.count !== undefined && t.count !== null" class="tab-count">{{ t.count }}</span>
    </button>
  </div>
</template>
