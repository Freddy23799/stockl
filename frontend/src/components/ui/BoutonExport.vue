<script setup>
import { ref } from 'vue'
import { telechargerDocument, nommerDocument } from '../../utils/telecharger'
import Icon from './Icon.vue'

// Bouton d'export PDF. Il transporte les filtres de l'ecran d'ou il est appele :
// un rapport imprime doit dire exactement la meme chose que la page affichee,
// sinon il ne sert a rien.

const props = defineProps({
  // Chemin de l'endpoint, ex. '/exports/ventes.pdf'
  chemin: { type: String, required: true },
  // Filtres, identiques a ceux envoyes a l'endpoint JSON de l'ecran.
  params: { type: Object, default: () => ({}) },
  // Nom lisible, affiche dans l'indicateur de telechargement.
  libelle: { type: String, required: true },
  // Base du nom de fichier ; la date du tirage y est ajoutee.
  fichier: { type: String, required: true },
  variante: { type: String, default: '' },
  taille: { type: String, default: '' },
  texte: { type: String, default: 'Exporter en PDF' },
})

// Verrou local : deux clics rapproches produiraient deux fois le meme document.
const enCours = ref(false)

async function exporter() {
  if (enCours.value) return
  enCours.value = true
  try {
    // Les filtres vides ne sont pas transmis : ils encombreraient l'URL et
    // certains endpoints traitent une chaine vide differemment d'une absence.
    const params = Object.fromEntries(
      Object.entries(props.params).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    )
    await telechargerDocument(props.chemin, {
      params,
      libelle: props.libelle,
      nomFichier: nommerDocument(props.fichier),
    })
  } finally {
    enCours.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="btn"
    :class="[variante, taille]"
    :disabled="enCours"
    :title="`${texte} - ${libelle}`"
    @click="exporter"
  >
    <span v-if="enCours" class="spinner" />
    <Icon v-else name="download" :size="15" />
    <span class="bouton-export-texte">{{ texte }}</span>
  </button>
</template>

<style scoped>
/* Sur telephone, l'intitule cede la place : l'icone seule suffit a comprendre,
   et la barre d'outils tient sur une ligne. */
@media (max-width: 700px) {
  .bouton-export-texte { display: none; }
}
</style>
