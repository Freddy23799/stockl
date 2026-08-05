<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  page: { type: Number, required: true },
  pageSize: { type: Number, required: true },
  total: { type: Number, required: true },
})
const emit = defineEmits(['update:page'])

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const debut = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const fin = computed(() => Math.min(props.page * props.pageSize, props.total))
</script>

<template>
  <div class="pagination">
    <span class="pagination-info">
      <template v-if="total > 0">{{ debut }}–{{ fin }} sur {{ total }}</template>
      <template v-else>Aucun resultat</template>
    </span>
    <div class="toolbar-spacer" />
    <button type="button" class="btn-sm" :disabled="page <= 1" @click="emit('update:page', page - 1)">
      <Icon name="chevronLeft" :size="14" /> Precedent
    </button>
    <span class="pagination-info nowrap">Page {{ page }} / {{ totalPages }}</span>
    <button type="button" class="btn-sm" :disabled="page >= totalPages" @click="emit('update:page', page + 1)">
      Suivant <Icon name="chevronRight" :size="14" />
    </button>
  </div>
</template>
