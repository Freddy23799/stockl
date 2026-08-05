<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
})
</script>

<template>
  <header class="page-head">
    <div class="page-head-text">
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="page-head-sub">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="page-head-actions">
      <slot name="actions" />
    </div>
  </header>
</template>
