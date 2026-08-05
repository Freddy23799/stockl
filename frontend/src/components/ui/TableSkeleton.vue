<script setup>
// Squelette de tableau : conserve la hauteur et le rythme de la vraie liste
// pendant le chargement, au lieu d'un "Chargement..." qui fait sauter la page
// quand les donnees arrivent.
defineProps({
  rows: { type: Number, default: 5 },
  cols: { type: Number, default: 4 },
})
</script>

<template>
  <div class="table-wrap">
    <table>
      <tbody>
        <tr v-for="r in rows" :key="r">
          <td v-for="c in cols" :key="c">
            <div class="skeleton" :style="{ width: c === 1 ? '58%' : c === cols ? '42%' : '72%' }" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
