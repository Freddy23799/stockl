<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api/client'
import { useToastStore } from '../stores/toasts'
import PageHeader from '../components/ui/PageHeader.vue'
import Modal from '../components/ui/Modal.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Icon from '../components/ui/Icon.vue'

const toasts = useToastStore()
const clients = ref([]); const loading = ref(true); const erreur = ref(''); const recherche = ref('')
const modal = ref(false); const edition = ref(false); const soumission = ref(false); const aArchiver = ref(null)
const form = reactive({ id: null, nom: '', telephone: '', email: '', adresse: '', type: 'particulier' })
const liste = computed(() => { const q = recherche.value.trim().toLowerCase(); return q ? clients.value.filter((c) => `${c.nom} ${c.code} ${c.telephone || ''} ${c.email || ''}`.toLowerCase().includes(q)) : clients.value })
async function charger() { loading.value = true; try { const { data } = await api.get('/clients'); clients.value = data } catch (err) { erreur.value = err.response?.data?.message || 'Impossible de charger les clients' } finally { loading.value = false } }
function ouvrirCreation() { edition.value = false; Object.assign(form, { id: null, nom: '', telephone: '', email: '', adresse: '', type: 'particulier' }); modal.value = true }
function ouvrirEdition(c) { edition.value = true; Object.assign(form, c); modal.value = true }
async function enregistrer() { soumission.value = true; try { const payload = { nom: form.nom, telephone: form.telephone, email: form.email, adresse: form.adresse, type: form.type }; if (edition.value) await api.put(`/clients/${form.id}`, payload); else await api.post('/clients', payload); modal.value = false; toasts.succes(edition.value ? 'Client mis a jour' : 'Client cree'); await charger() } catch (err) { toasts.erreur(err.response?.data?.message || 'Enregistrement impossible') } finally { soumission.value = false } }
async function archiver() { try { await api.patch(`/clients/${aArchiver.value.id}/desactiver`); aArchiver.value = null; toasts.succes('Client archive'); await charger() } catch (err) { toasts.erreur(err.response?.data?.message || 'Archivage impossible') } }
onMounted(charger)
</script>
<template><div>
  <PageHeader title="Clients" subtitle="Referentiel client partage pour ventes, factures et suivi commercial."><template #actions><button class="primary" @click="ouvrirCreation"><Icon name="plus" :size="15" /> Nouveau client</button></template></PageHeader>
  <p v-if="erreur" class="alert alert-danger"><Icon name="alert" :size="16" /> {{ erreur }}</p>
  <div class="card"><div class="card-head"><input v-model="recherche" placeholder="Rechercher un client..." /></div><div class="card-body card-body-flush">
    <p v-if="loading" class="muted" style="padding:16px">Chargement...</p><EmptyState v-else-if="!liste.length" icon="users" title="Aucun client" desc="Creez le premier client de votre entreprise." />
    <div v-else class="table-wrap"><table class="table-cards"><thead><tr><th>Client</th><th>Contact</th><th>Type</th><th class="td-actions">Actions</th></tr></thead><tbody><tr v-for="c in liste" :key="c.id"><td><div class="td-strong">{{ c.nom }}</div><div class="small muted">{{ c.code }}</div></td><td><div>{{ c.telephone || '—' }}</div><div class="small muted">{{ c.email || '' }}</div></td><td><span class="badge">{{ c.type === 'entreprise' ? 'Entreprise' : 'Particulier' }}</span></td><td class="td-actions"><button class="btn-sm btn-ghost" title="Modifier" @click="ouvrirEdition(c)"><Icon name="edit" :size="15" /></button><button class="btn-sm btn-ghost" title="Archiver" style="color:var(--danger)" @click="aArchiver = c"><Icon name="trash" :size="15" /></button></td></tr></tbody></table></div>
  </div></div>
  <Modal v-if="modal" :title="edition ? 'Modifier le client' : 'Nouveau client'" @close="modal=false"><form id="client-form" class="stack" @submit.prevent="enregistrer"><div class="field"><label>Nom / raison sociale</label><input v-model="form.nom" required /></div><div class="field-row"><div class="field"><label>Telephone</label><input v-model="form.telephone" /></div><div class="field"><label>Email</label><input v-model="form.email" type="email" /></div></div><div class="field"><label>Type</label><select v-model="form.type"><option value="particulier">Particulier</option><option value="entreprise">Entreprise</option></select></div><div class="field"><label>Adresse</label><textarea v-model="form.adresse" rows="3" /></div></form><template #footer><button @click="modal=false">Annuler</button><button class="primary" form="client-form" :disabled="soumission">{{ soumission ? 'Enregistrement...' : 'Enregistrer' }}</button></template></Modal>
  <ConfirmDialog v-if="aArchiver" title="Archiver ce client ?" :message="`Le client ${aArchiver.nom} ne pourra plus etre selectionne pour une nouvelle operation.`" confirm-label="Archiver" danger @close="aArchiver=null" @confirm="archiver" />
</div></template>
