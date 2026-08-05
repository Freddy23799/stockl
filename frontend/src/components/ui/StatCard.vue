<script setup>
import Icon from './Icon.vue'

// Tuile de statistique. `trend` est un pourcentage signe (ou null si la
// comparaison n'a pas de sens - premiere journee, division par zero...).
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  icon: { type: String, default: '' },
  tone: { type: String, default: '' },
  trend: { type: Number, default: null },
  trendLabel: { type: String, default: '' },
  hint: { type: String, default: '' },
})
</script>

<template>
  <div class="stat">
    <div class="stat-top">
      <span v-if="icon" class="stat-icon" :class="tone ? `is-${tone}` : ''">
        <Icon :name="icon" :size="15" />
      </span>
      <span class="stat-label">{{ label }}</span>
    </div>
    <div class="stat-value">{{ value }}</div>
    <div v-if="trend !== null || hint" class="stat-foot">
      <span v-if="trend !== null" class="trend" :class="trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'">
        <Icon :name="trend > 0 ? 'arrowUp' : trend < 0 ? 'arrowDown' : 'arrowRight'" :size="13" />
        {{ Math.abs(trend).toFixed(1) }}%
      </span>
      <span v-if="trendLabel">{{ trendLabel }}</span>
      <span v-else-if="hint">{{ hint }}</span>
    </div>
  </div>
</template>
