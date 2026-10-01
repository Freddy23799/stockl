<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api/client'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toasts'
import { formatDate, formatMontant } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Icon from '../components/ui/Icon.vue'

const auth = useAuthStore(); const toasts = useToastStore()
const demandes = ref([]); const approbateurs = ref([]); const loading = ref(true); const erreur = ref(''); const filtre = ref('toutes')
const creationVisible = ref(false); const soumission = ref(false); const rejet = ref(null); const motifRejet = ref('')
const form = reactive({ type_document: 'demande', titre: '', description: '', montant: '', approbateur_id: '' })
const estSuperAdmin = computed(() => auth.user?.role === 'admin')
const liste = computed(() => filtre.value === 'toutes' ? demandes.value : demandes.value.filter((d) => d.statut === filtre.value))
const statutLibelle = { brouillon: 'Brouillon', soumis: 'En attente', approuve: 'Approuve', rejete: 'Rejete', annule: 'Annule' }
function classe(s) { return ({ approuve: 'success', rejete: 'danger', soumis: 'warning' })[s] || '' }
async function charger() { loading.value = true; erreur.value = ''; try { const { data } = await api.get('/approbations'); demandes.value = data } catch (e) { erreur.value = e.response?.data?.message || 'Impossible de charger les demandes.' } finally { loading.value = false } }
async function ouvrirCreation() { Object.assign(form, { type_document: 'demande', titre: '', description: '', montant: '', approbateur_id: '' }); try { const { data } = await api.get('/approbations/approbateurs'); approbateurs.value = data; creationVisible.value = true } catch (e) { toasts.erreur(e.response?.data?.message || 'Impossible de charger les approbateurs') } }
async function creer() { soumission.value = true; try { const { data } = await api.post('/approbations', form); await api.post(`/approbations/${data.id}/soumettre`); creationVisible.value = false; toasts.succes('Demande soumise pour approbation'); await charger() } catch (e) { toasts.erreur(e.response?.data?.message || 'Creation impossible') } finally { soumission.value = false } }
async function approuver(d) { try { await api.post(`/approbations/${d.id}/approuver`); toasts.succes('Demande approuvee'); await charger() } catch (e) { toasts.erreur(e.response?.data?.message || 'Approbation impossible') } }
async function rejeter() { try { await api.post(`/approbations/${rejet.value.id}/rejeter`, { motif: motifRejet.value }); rejet.value = null; motifRejet.value = ''; toasts.succes('Demande rejetee'); await charger() } catch (e) { toasts.erreur(e.response?.data?.message || 'Rejet impossible') } }
function peutTraiter(d) { return d.statut === 'soumis' && (estSuperAdmin.value || !d.approbateur_id || d.approbateur_id === auth.user?.id) }
onMounted(charger)
</script>
<template><div>
  <PageHeader title="Demandes et approbations" subtitle="Les operations sensibles restent bloquees jusqu'a leur validation."><template #actions><button class="primary" @click="ouvrirCreation"><Icon name="plus" :size="15" /> Nouvelle demande</button></template></PageHeader>
  <p v-if="erreur" class="alert alert-danger"><Icon name="alert" :size="16" /> {{ erreur }}</p>
  <div class="tabs mb-4"><button v-for="s in ['toutes','soumis','brouillon','approuve','rejete']" :key="s" type="button" :class="{ active: filtre === s }" @click="filtre=s">{{ s === 'toutes' ? 'Toutes' : statutLibelle[s] }}</button></div>
  <div class="card"><div class="card-body card-body-flush"><p v-if="loading" class="muted" style="padding:16px">Chargement...</p><EmptyState v-else-if="!liste.length" icon="check" title="Aucune demande" desc="Creez une demande pour demarrer un workflow de validation." /><div v-else class="table-wrap"><table class="table-cards"><thead><tr><th>Demande</th><th>Demandeur</th><th>Montant</th><th>Statut</th><th class="td-actions">Actions</th></tr></thead><tbody><tr v-for="d in liste" :key="d.id"><td><div class="td-strong">{{ d.titre }}</div><div class="small muted">{{ d.type_document }} · {{ formatDate(d.created_at) }}</div><div v-if="d.motif_rejet" class="small" style="color:var(--danger)">{{ d.motif_rejet }}</div></td><td>{{ d.demandeur_nom }}</td><td>{{ d.montant == null ? '—' : formatMontant(d.montant) }}</td><td><span class="badge" :class="classe(d.statut)">{{ statutLibelle[d.statut] }}</span></td><td class="td-actions"><template v-if="peutTraiter(d)"><button class="btn-sm" style="color:var(--success)" @click="approuver(d)"><Icon name="check" :size="15" /> Approuver</button><button class="btn-sm btn-ghost" style="color:var(--danger)" @click="rejet=d"><Icon name="close" :size="15" /> Rejeter</button></template><span v-else class="small muted">{{ d.approbateur_nom || 'En attente' }}</span></td></tr></tbody></table></div></div></div>
  <Modal v-if="creationVisible" title="Nouvelle demande" @close="creationVisible=false"><form id="approval-form" class="stack" @submit.prevent="creer"><div class="field"><label>Type de document</label><select v-model="form.type_document"><option value="depense">Depense</option><option value="achat">Achat</option><option value="stock">Ajustement de stock</option><option value="conge">Conge</option><option value="demande">Demande generale</option></select></div><div class="field"><label>Titre</label><input v-model="form.titre" required placeholder="Ex. Achat de parfums fournisseur X" /></div><div class="field"><label>Montant (facultatif)</label><input v-model="form.montant" type="number" min="0" step="0.01" /></div><div class="field"><label>Approbateur</label><select v-model="form.approbateur_id"><option value="">Tout approbateur autorise</option><option v-for="u in approbateurs" :key="u.id" :value="u.id">{{ u.prenom }} {{ u.nom }} — {{ u.role }}</option></select></div><div class="field"><label>Justification</label><textarea v-model="form.description" rows="4" /></div></form><template #footer><button @click="creationVisible=false">Annuler</button><button class="primary" form="approval-form" :disabled="soumission">{{ soumission ? 'Envoi...' : 'Soumettre' }}</button></template></Modal>
  <Modal v-if="rejet" title="Rejeter la demande" @close="rejet=null"><div class="field"><label>Motif obligatoire</label><textarea v-model="motifRejet" rows="4" required /></div><template #footer><button @click="rejet=null">Annuler</button><button class="danger" :disabled="!motifRejet.trim()" @click="rejeter">Rejeter</button></template></Modal>
</div></template>
