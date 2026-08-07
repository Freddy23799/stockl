<script setup>
import { nouvelleVersion, appliquerMiseAJour } from '../../pwa'
import Icon from './Icon.vue'

// Volontairement un bandeau a accepter, et non un rechargement automatique.
// L'application est une caisse : recharger la page sans prevenir ferait perdre
// une vente en cours de saisie. Le bandeau attend, sans bloquer quoi que ce
// soit - on peut finir l'encaissement puis mettre a jour.
</script>

<template>
  <Transition name="maj">
    <div v-if="nouvelleVersion" class="maj" role="status">
      <Icon name="refresh" :size="17" />
      <div class="maj-texte">
        <div class="maj-titre">Nouvelle version disponible</div>
        <div class="maj-sous">Terminez ce que vous faites, puis mettez a jour.</div>
      </div>
      <button type="button" class="primary btn-sm" @click="appliquerMiseAJour">
        Mettre a jour
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.maj {
  position: fixed;
  left: 20px;
  /* Au-dessus de la barre de navigation du bas sur telephone, sinon le bouton
     passe sous les onglets et devient inatteignable. */
  bottom: calc(20px + env(safe-area-inset-bottom));
  z-index: 210;
  display: flex;
  align-items: center;
  gap: 11px;
  max-width: min(430px, calc(100vw - 40px));
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
}

.maj .icon { flex-shrink: 0; color: var(--accent); }
.maj-texte { flex: 1; min-width: 0; }
.maj-titre { font-size: 13.5px; font-weight: 600; color: var(--text-h); }
.maj-sous { font-size: 12px; color: var(--text-muted); margin-top: 1px; }
.maj button { flex-shrink: 0; }

@media (max-width: 760px) {
  .maj {
    left: 12px;
    right: 12px;
    max-width: none;
    /* La barre d'onglets du bas mesure 57 px : sans ce decalage le bandeau
       recouvrirait la navigation. */
    bottom: calc(74px + env(safe-area-inset-bottom));
  }
}

.maj-enter-active, .maj-leave-active { transition: all 220ms cubic-bezier(0.4, 0, 0.2, 1); }
.maj-enter-from, .maj-leave-to { opacity: 0; transform: translateY(14px); }
</style>
