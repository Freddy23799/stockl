<script setup>
import { computed } from 'vue'

const props = defineProps({
  page: { type: Number, required: true },
  pageSize: { type: Number, required: true },
  total: { type: Number, required: true },
})
const emit = defineEmits(['update:page'])

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

function precedent() {
  if (props.page > 1) emit('update:page', props.page - 1)
}
function suivant() {
  if (props.page < totalPages.value) emit('update:page', props.page + 1)
}
</script>

<template>
  <div class="toolbar pagination">
    <span>Page {{ page }} sur {{ totalPages }} ({{ total }} au total)</span>
    <button type="button" :disabled="page <= 1" @click="precedent">← Precedent</button>
    <button type="button" :disabled="page >= totalPages" @click="suivant">Suivant →</button>
  </div>
</template>

<style scoped>
.pagination {
  align-items: center;
  margin-top: 12px;
  margin-bottom: 0;
  font-size: 13px;
}
</style>
