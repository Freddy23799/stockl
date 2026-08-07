<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import api, { assetUrl } from '../api/client'
import { useToastStore } from '../stores/toasts'
import { useAuthStore } from '../stores/auth'
import { formatMontant, formatQuantite, formatDate } from '../utils/format'
import { telechargerDocument } from '../utils/telecharger'
import PageHeader from '../components/ui/PageHeader.vue'
import BoutonExport from '../components/ui/BoutonExport.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import TableSkeleton from '../components/ui/TableSkeleton.vue'
import StatCard from '../components/ui/StatCard.vue'
import Pagination from '../components/ui/Pagination.vue'
import Icon from '../components/ui/Icon.vue'

const toasts = useToastStore()
const auth = useAuthStore()

const produits = ref([])
const vendeuses = ref([])
const ventes = ref([])
const loading = ref(true)
const erreur = ref('')

const ongletActif = ref('caisse')
const onglets = computed(() => [
  { id: 'caisse', label: 'Nouvelle vente', icon: 'cart', count: lignesPanier.value.length || null },
  { id: 'historique', label: 'Historique', icon: 'history', count: total.value },
])

/* --- Caisse -------------------------------------------------------------- */

const typeVente = ref('directe')
const codeVendeuse = ref('')
const vendeuseTrouvee = ref(null)
const codeRecherche = ref(false)
const codeErreur = ref('')
const produitSelectionne = ref('')
const quantiteSelectionnee = ref(1)
const rechercheProduit = ref('')
const lignesPanier = ref([])
const venteSoumission = ref(false)

const totalPanier = computed(() =>
  lignesPanier.value.reduce((s, l) => s + l.prix_vente * l.quantite, 0)
)
const articlesPanier = computed(() =>
  lignesPanier.value.reduce((s, l) => s + Number(l.quantite || 0), 0)
)

// Filtre par rayon : sur un catalogue de plusieurs dizaines de references, il
// evite de faire defiler toute la grille pour retrouver une famille d'articles.
const rayonActif = ref('')

const rayons = computed(() => {
  const parId = new Map()
  for (const p of produits.value) {
    if (!p.categorie_id) continue
    const compte = parId.get(p.categorie_id)
    if (compte) compte.nombre += 1
    else parId.set(p.categorie_id, { id: p.categorie_id, nom: p.categorie, nombre: 1 })
  }
  return [...parId.values()].sort((a, b) => a.nom.localeCompare(b.nom))
})

const produitsFiltres = computed(() => {
  const q = rechercheProduit.value.trim().toLowerCase()
  let liste = produits.value
  if (rayonActif.value) {
    liste = liste.filter((p) => String(p.categorie_id) === String(rayonActif.value))
  }
  if (!q) return liste
  // La recherche porte aussi sur le rayon et la marque : en caisse on tape
  // aussi bien « riz » que « Bijou », et les deux doivent ramener l'etagere.
  return liste.filter((p) => `${p.nom} ${p.categorie || ''} ${p.marque || ''}`
    .toLowerCase().includes(q))
})

const produitChoisi = computed(
  () => produits.value.find((p) => p.id === Number(produitSelectionne.value)) || null
)

// Le stock affiche tient compte de ce qui est deja reserve dans le panier :
// sinon on peut ajouter deux fois la meme quantite et se croire couvert.
const stockRestant = computed(() => {
  if (!produitChoisi.value) return 0
  const deja = lignesPanier.value.find((l) => l.produit_id === produitChoisi.value.id)
  return Number(produitChoisi.value.quantite_stock) - Number(deja?.quantite || 0)
})

const depassementStock = computed(
  () => !!produitChoisi.value && Number(quantiteSelectionnee.value) > stockRestant.value
)

function stockDe(produitId) {
  const p = produits.value.find((x) => x.id === produitId)
  return p ? Number(p.quantite_stock) : Infinity
}

const panierValide = computed(() =>
  lignesPanier.value.every((l) => Number(l.quantite) > 0 && Number(l.quantite) <= stockDe(l.produit_id))
)

let timeoutRecherche = null
watch(codeVendeuse, (val) => {
  vendeuseTrouvee.value = null
  codeErreur.value = ''
  clearTimeout(timeoutRecherche)
  if (!/^\d{6}$/.test(val)) return
  timeoutRecherche = setTimeout(async () => {
    codeRecherche.value = true
    try {
      const { data } = await api.get(`/vendeuses/code/${val}`)
      if (!data.actif) {
        codeErreur.value = 'Cette vendeuse est desactivee'
      } else {
        vendeuseTrouvee.value = data
      }
    } catch {
      codeErreur.value = 'Aucune vendeuse ne correspond a ce code'
    } finally {
      codeRecherche.value = false
    }
  }, 300)
})

/* --- Persistance du panier ------------------------------------------------
   Le panier vit dans localStorage, pas cote serveur, et c'est volontaire : le
   client fait tourner plusieurs postes de vente sur le MEME compte. Un panier
   stocke en base serait partage entre les postes et deux caissieres se
   marcheraient dessus a chaque article. localStorage est propre a un
   navigateur : chaque poste garde sa saisie.
   La cle porte l'identifiant de l'utilisateur pour qu'un panier ne survive pas
   a un changement de compte sur le meme poste. */
const clePanier = computed(() => (auth.user?.id ? `machibel.panier.${auth.user.id}` : null))

// Tant que la restauration n'a pas eu lieu, on n'ecrit rien : sinon le premier
// declenchement du watch ecraserait la saisie enregistree par un panier vide.
let panierRestaure = false

function enregistrerPanier() {
  if (!panierRestaure || !clePanier.value) return
  try {
    const rienASauver =
      !lignesPanier.value.length && typeVente.value === 'directe' && !codeVendeuse.value
    if (rienASauver) {
      localStorage.removeItem(clePanier.value)
      return
    }
    localStorage.setItem(
      clePanier.value,
      JSON.stringify({
        // Seuls l'identifiant et la quantite sont conserves : le nom et le prix
        // sont relus dans le catalogue a la restauration, ils ont pu changer.
        lignes: lignesPanier.value.map((l) => ({ produit_id: l.produit_id, quantite: l.quantite })),
        typeVente: typeVente.value,
        codeVendeuse: codeVendeuse.value,
      })
    )
  } catch {
    // Navigation privee, quota depasse, stockage desactive : on perd la reprise
    // apres rafraichissement, jamais la vente en cours. La caisse continue.
  }
}

function purgerPanier() {
  try {
    if (clePanier.value) localStorage.removeItem(clePanier.value)
  } catch {
    // Meme raison : un echec de purge ne doit rien interrompre.
  }
}

// A appeler une fois le catalogue charge : le tri des lignes obsoletes en depend.
function restaurerPanier() {
  panierRestaure = true
  if (!clePanier.value) return

  let enregistre = null
  try {
    const brut = localStorage.getItem(clePanier.value)
    enregistre = brut ? JSON.parse(brut) : null
  } catch {
    enregistre = null
  }
  if (!enregistre) return

  const retenues = []
  let retirees = 0
  for (const l of Array.isArray(enregistre.lignes) ? enregistre.lignes : []) {
    // /produits ne renvoie que les produits actifs : une ligne dont le produit
    // est introuvable pointe sur un produit archive ou supprime depuis.
    const produit = produits.value.find((p) => p.id === Number(l.produit_id))
    const quantite = Number(l.quantite)
    if (!produit || !Number.isFinite(quantite) || quantite <= 0) {
      retirees += 1
      continue
    }
    retenues.push({
      produit_id: produit.id,
      nom: produit.nom,
      unite_stock: produit.unite_stock,
      prix_vente: Number(produit.prix_vente),
      quantite,
    })
  }

  lignesPanier.value = retenues
  if (enregistre.typeVente === 'directe' || enregistre.typeVente === 'vendeuse') {
    typeVente.value = enregistre.typeVente
  }
  // Reaffecter le code relance la verification de la vendeuse : elle a pu etre
  // desactivee entre-temps, on ne restaure pas un code valide par principe.
  if (typeof enregistre.codeVendeuse === 'string') codeVendeuse.value = enregistre.codeVendeuse

  if (retirees) {
    toasts.info(
      `${retirees} ligne(s) retiree(s) du panier restaure : ces produits ne sont plus au catalogue.`
    )
  }
}

watch([lignesPanier, typeVente, codeVendeuse], enregistrerPanier, { deep: true })

/* --- Panier --------------------------------------------------------------- */

// La ligne concernee s'eclaire une seconde apres l'ajout : sur un panier long,
// c'est le seul moyen de voir ou l'article vient d'atterrir.
const ligneSurlignee = ref(null)
let timeoutSurlignage = null

function surligner(produitId) {
  clearTimeout(timeoutSurlignage)
  ligneSurlignee.value = produitId
  timeoutSurlignage = setTimeout(() => { ligneSurlignee.value = null }, 1000)
}

function choisirProduit(p) {
  produitSelectionne.value = p.id
  quantiteSelectionnee.value = 1
}

function ajouterLigne() {
  const produit = produitChoisi.value
  if (!produit || quantiteSelectionnee.value <= 0) return

  const existante = lignesPanier.value.find((l) => l.produit_id === produit.id)
  if (existante) {
    existante.quantite += Number(quantiteSelectionnee.value)
  } else {
    lignesPanier.value.push({
      produit_id: produit.id,
      nom: produit.nom,
      unite_stock: produit.unite_stock,
      prix_vente: Number(produit.prix_vente),
      quantite: Number(quantiteSelectionnee.value),
    })
  }
  surligner(produit.id)
  produitSelectionne.value = ''
  quantiteSelectionnee.value = 1
}

// Au doigt, deux boutons valent mieux qu'un champ numerique : on n'ouvre pas le
// clavier et on ne vise pas les fleches de 8 px du champ natif.
function ajusterQuantite(ligne, delta) {
  const q = Number(ligne.quantite) + delta
  ligne.quantite = Math.max(1, Math.min(q, stockDe(ligne.produit_id)))
}

function retirerLigne(index) {
  lignesPanier.value.splice(index, 1)
}

// Une quantite vide ou nulle saisie a la main viderait la ligne sans la retirer :
// on ramene au minimum vendable plutot que d'envoyer un zero au serveur.
function normaliserLigne(ligne) {
  const q = Number(ligne.quantite)
  if (!Number.isFinite(q) || q < 1) ligne.quantite = 1
}

function viderPanier() {
  lignesPanier.value = []
  purgerPanier()
}

async function validerVente() {
  if (!lignesPanier.value.length) return
  venteSoumission.value = true
  const montant = totalPanier.value
  try {
    const payload = {
      type: typeVente.value,
      vendeuse_code: typeVente.value === 'vendeuse' ? codeVendeuse.value : undefined,
      lignes: lignesPanier.value.map((l) => ({ produit_id: l.produit_id, quantite: l.quantite })),
    }
    await api.post('/ventes', payload)
    lignesPanier.value = []
    typeVente.value = 'directe'
    codeVendeuse.value = ''
    vendeuseTrouvee.value = null
    produitSelectionne.value = ''
    rechercheProduit.value = ''
    // La saisie est terminee : rien ne doit revenir au prochain rafraichissement.
    purgerPanier()
    toasts.succes(`Vente enregistree — ${formatMontant(montant)}`)
    await chargerVentes()
    await chargerProduits()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur lors de l\'enregistrement de la vente')
  } finally {
    venteSoumission.value = false
  }
}

/* --- Historique ---------------------------------------------------------- */

const filtres = reactive({ from: '', to: '', vendeuse_id: '' })
const detailVisible = ref(false)
const detailVente = ref(null)
const detailChargement = ref(false)
const chargementVentes = ref(false)
const page = ref(1)
const pageSize = 20
const total = ref(0)

const filtreActif = computed(() => !!(filtres.from || filtres.to || filtres.vendeuse_id))

// Statistiques calculees sur la page deja chargee : aucun appel supplementaire.
const totalAffiche = computed(() => ventes.value.reduce((s, v) => s + Number(v.montant_total), 0))
const panierMoyen = computed(() =>
  ventes.value.length ? totalAffiche.value / ventes.value.length : 0
)

async function chargerVentes() {
  chargementVentes.value = true
  try {
    const params = { page: page.value, pageSize }
    if (filtres.from) params.from = filtres.from
    if (filtres.to) params.to = filtres.to
    if (filtres.vendeuse_id) params.vendeuse_id = filtres.vendeuse_id
    const { data } = await api.get('/ventes', { params })
    ventes.value = data.data
    total.value = data.total
  } finally {
    chargementVentes.value = false
  }
}

async function filtrerVentes() {
  page.value = 1
  try {
    await chargerVentes()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur lors du filtrage')
  }
}

function reinitialiserFiltres() {
  filtres.from = ''
  filtres.to = ''
  filtres.vendeuse_id = ''
  filtrerVentes()
}

async function changerPage(nouvellePage) {
  page.value = nouvellePage
  try {
    await chargerVentes()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur de chargement')
  }
}

async function chargerProduits() {
  const { data } = await api.get('/produits')
  produits.value = data
}

/* --- Facture -------------------------------------------------------------- */

// Le telechargement passe par le gestionnaire de l'application, comme les
// autres documents : la barre de progression apparait, et un refus du serveur
// remonte lisiblement au lieu d'ouvrir un onglet vide.
const factureEnCours = ref(null)

async function telechargerFacture(v) {
  factureEnCours.value = v.id
  try {
    await telechargerDocument(`/exports/factures/${v.id}.pdf`, {
      libelle: `Facture ${v.numero_facture}`,
      nomFichier: `facture-${v.numero_facture}.pdf`,
    })
  } catch (err) {
    toasts.erreur(err.response?.data?.message || "La facture n'a pas pu etre generee")
  } finally {
    factureEnCours.value = null
  }
}

async function ouvrirDetail(v) {
  detailVisible.value = true
  detailChargement.value = true
  detailVente.value = null
  try {
    const { data } = await api.get(`/ventes/${v.id}`)
    detailVente.value = data
  } finally {
    detailChargement.value = false
  }
}

onMounted(async () => {
  loading.value = true
  erreur.value = ''
  let catalogueCharge = false
  try {
    await Promise.all([
      chargerProduits().then(() => { catalogueCharge = true }),
      chargerVentes(),
      api.get('/vendeuses').then((r) => { vendeuses.value = r.data }),
    ])
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
    // Sans catalogue on ne restaure PAS et on n'active pas la sauvegarde :
    // toutes les lignes passeraient pour obsoletes et le panier enregistre
    // serait detruit par un simple probleme de reseau.
    if (catalogueCharge) restaurerPanier()
  }
})

onUnmounted(() => {
  clearTimeout(timeoutRecherche)
  clearTimeout(timeoutSurlignage)
})
</script>

<template>
  <div>
    <PageHeader
      title="Ventes"
      subtitle="Encaissez a la caisse ou attribuez la vente a une vendeuse par son code : le stock est decremente immediatement."
    >
      <template #actions>
        <BoutonExport
          chemin="/exports/ventes.pdf"
          :params="filtres"
          libelle="Journal des ventes"
          fichier="journal-des-ventes"
        />
      </template>
    </PageHeader>

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <Tabs v-model="ongletActif" :tabs="onglets" />

    <!-- Caisse ---------------------------------------------------------- -->
    <div v-if="ongletActif === 'caisse'" class="caisse">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div class="card-head-text">
              <h2>Type de vente</h2>
              <p class="card-head-sub">A qui cette vente doit-elle etre attribuee ?</p>
            </div>
          </div>
          <div class="card-body stack" style="gap: 12px">
            <div class="btn-group">
              <button
                type="button"
                :class="{ 'is-active': typeVente === 'directe' }"
                @click="typeVente = 'directe'"
              >
                <Icon name="building" :size="15" /> Boutique
              </button>
              <button
                type="button"
                :class="{ 'is-active': typeVente === 'vendeuse' }"
                @click="typeVente = 'vendeuse'"
              >
                <Icon name="users" :size="15" /> Vendeuse
              </button>
            </div>

            <div v-if="typeVente === 'vendeuse'" class="field">
              <label>Code vendeuse</label>
              <input
                v-model="codeVendeuse"
                maxlength="6"
                inputmode="numeric"
                placeholder="123456"
                class="code-input"
              />
              <span v-if="codeRecherche" class="field-hint row">
                <span class="spinner" /> Recherche du code...
              </span>
              <span v-else-if="codeErreur" class="field-error">{{ codeErreur }}</span>
              <span v-else-if="vendeuseTrouvee" class="badge success mt-2">
                <Icon name="check" :size="13" /> {{ vendeuseTrouvee.nom }}
              </span>
              <span v-else class="field-hint">Les 6 chiffres remis a la vendeuse</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="search">
              <Icon name="search" :size="15" />
              <input v-model="rechercheProduit" type="search" placeholder="Rechercher un produit..." />
            </div>
            <span class="small muted">{{ produitsFiltres.length }} produit(s)</span>
          </div>

          <!-- Filtres par rayon. Masques quand aucun produit n'est classe :
               une barre de filtres vide n'apprend rien et prend la place. -->
          <div v-if="rayons.length" class="barre-rayons">
            <button
              type="button"
              class="puce-rayon"
              :class="{ 'is-active': !rayonActif }"
              @click="rayonActif = ''"
            >
              Tout <span class="puce-compte">{{ produits.length }}</span>
            </button>
            <button
              v-for="r in rayons"
              :key="r.id"
              type="button"
              class="puce-rayon"
              :class="{ 'is-active': String(rayonActif) === String(r.id) }"
              @click="rayonActif = String(rayonActif) === String(r.id) ? '' : r.id"
            >
              {{ r.nom }} <span class="puce-compte">{{ r.nombre }}</span>
            </button>
          </div>

          <div class="card-body card-body-flush">
            <TableSkeleton v-if="loading" :rows="5" :cols="2" />

            <EmptyState
              v-else-if="!produitsFiltres.length && rechercheProduit"
              icon="search"
              title="Aucun resultat"
              :desc="`Aucun produit ne correspond a « ${rechercheProduit} ».`"
            >
              <button type="button" @click="rechercheProduit = ''">Effacer la recherche</button>
            </EmptyState>

            <EmptyState
              v-else-if="!produitsFiltres.length"
              icon="package"
              title="Aucun produit en catalogue"
              desc="Creez d'abord vos produits : sans catalogue, aucune vente n'est possible."
            >
              <RouterLink to="/produits" class="btn primary">
                <Icon name="package" :size="15" /> Aller au catalogue
              </RouterLink>
            </EmptyState>

            <!-- Des cartes plutot qu'une liste de lignes : en caisse, on
                 reconnait un article a son flacon bien avant de lire son nom.
                 Vingt references dont les noms ne different que par un parfum
                 ou un volume se confondent en liste ; avec la photo et le prix
                 en gros, on verifie d'un coup d'oeil qu'on tient le bon. -->
            <div v-else class="grille-produits">
              <button
                v-for="p in produitsFiltres"
                :key="p.id"
                type="button"
                class="carte-produit"
                :class="{
                  'is-active': Number(produitSelectionne) === p.id,
                  'est-epuise': Number(p.quantite_stock) <= 0,
                }"
                @click="choisirProduit(p)"
              >
                <span class="carte-visuel">
                  <img v-if="p.photo" :src="assetUrl(p.photo, { taille: 'vignette' })" :alt="p.nom" loading="lazy" />
                  <Icon v-else name="package" :size="22" />
                  <span
                    class="carte-stock"
                    :class="Number(p.quantite_stock) <= Number(p.seuil_alerte) ? 'danger' : 'success'"
                  >
                    {{ formatQuantite(p.quantite_stock) }} {{ p.unite_stock }}
                  </span>
                  <span v-if="Number(produitSelectionne) === p.id" class="carte-coche">
                    <Icon name="check" :size="13" />
                  </span>
                </span>
                <span class="carte-nom">{{ p.nom }}</span>
                <span v-if="p.marque || p.categorie" class="carte-classement">
                  <span v-if="p.marque" class="carte-marque">{{ p.marque }}</span>
                  <span v-if="p.categorie" class="carte-rayon">{{ p.categorie }}</span>
                </span>
                <span class="carte-prix tnum">{{ formatMontant(p.prix_vente) }}</span>
              </button>
            </div>
          </div>

          <div v-if="produitChoisi" class="card-foot" style="align-items: flex-end">
            <div class="field" style="flex: 1; min-width: 160px">
              <label>{{ produitChoisi.nom }}</label>
              <input
                v-model.number="quantiteSelectionnee"
                type="number"
                min="1"
                step="1"
                @keyup.enter="!depassementStock && ajouterLigne()"
              />
              <span class="field-hint tnum">
                Disponible : {{ formatQuantite(stockRestant) }} {{ produitChoisi.unite_stock }}
              </span>
            </div>
            <button type="button" class="primary" :disabled="depassementStock" @click="ajouterLigne">
              <Icon name="plus" :size="15" /> Ajouter
            </button>
          </div>

          <div v-if="depassementStock" class="card-foot">
            <p class="alert alert-warning" style="width: 100%">
              <Icon name="warning" :size="16" />
              <span>
                Stock insuffisant : il ne reste que
                {{ formatQuantite(stockRestant) }} {{ produitChoisi.unite_stock }}
                <template v-if="lignesPanier.some((l) => l.produit_id === produitChoisi.id)">
                  une fois le panier deduit
                </template>.
              </span>
            </p>
          </div>
        </div>
      </div>

      <!-- Panier -->
      <div class="card panier">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Panier</h2>
            <p class="card-head-sub">{{ formatQuantite(articlesPanier) }} article(s)</p>
          </div>
          <button
            v-if="lignesPanier.length"
            type="button"
            class="btn-sm btn-ghost"
            style="color: var(--danger)"
            @click="viderPanier"
          >
            <Icon name="trash" :size="14" /> Vider
          </button>
        </div>

        <div class="card-body card-body-flush">
          <EmptyState
            v-if="!lignesPanier.length"
            icon="cart"
            title="Panier vide"
            desc="Choisissez un produit dans la liste, indiquez la quantite puis ajoutez-le au panier."
          />

          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th style="width: 124px">Qte</th>
                  <th class="td-num">Sous-total</th>
                  <th style="width: 40px"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(l, i) in lignesPanier"
                  :key="l.produit_id"
                  :class="{ 'is-ajoutee': ligneSurlignee === l.produit_id }"
                >
                  <td>
                    <div class="td-strong">{{ l.nom }}</div>
                    <div class="small muted tnum">{{ formatMontant(l.prix_vente) }} / {{ l.unite_stock }}</div>
                    <span v-if="Number(l.quantite) > stockDe(l.produit_id)" class="badge danger mt-2">
                      <Icon name="warning" :size="12" /> Stock insuffisant
                    </span>
                  </td>
                  <td>
                    <div class="qte-ctrl">
                      <button
                        type="button"
                        class="btn-sm"
                        :aria-label="`Retirer un ${l.unite_stock}`"
                        :disabled="Number(l.quantite) <= 1"
                        @click="ajusterQuantite(l, -1)"
                      >−</button>
                      <input
                        v-model.number="l.quantite"
                        type="number"
                        min="1"
                        step="1"
                        class="qte-input"
                        @change="normaliserLigne(l)"
                      />
                      <button
                        type="button"
                        class="btn-sm"
                        :aria-label="`Ajouter un ${l.unite_stock}`"
                        :disabled="Number(l.quantite) >= stockDe(l.produit_id)"
                        @click="ajusterQuantite(l, 1)"
                      >+</button>
                    </div>
                  </td>
                  <td class="td-num td-strong tnum nowrap">{{ formatMontant(l.prix_vente * l.quantite) }}</td>
                  <td class="td-actions">
                    <button
                      type="button"
                      class="btn-sm btn-ghost"
                      title="Retirer"
                      style="color: var(--danger)"
                      @click="retirerLigne(i)"
                    >
                      <Icon name="x" :size="15" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card-foot total-foot">
          <div class="row-between" style="width: 100%">
            <span class="stat-label">Total a encaisser</span>
            <span class="total-montant tnum">{{ formatMontant(totalPanier) }}</span>
          </div>
          <button
            type="button"
            class="primary btn-block"
            :disabled="
              !lignesPanier.length ||
              venteSoumission ||
              !panierValide ||
              (typeVente === 'vendeuse' && !vendeuseTrouvee)
            "
            @click="validerVente"
          >
            <span v-if="venteSoumission" class="spinner" />
            <Icon v-else name="check" :size="15" />
            Valider la vente
          </button>
          <p v-if="typeVente === 'vendeuse' && !vendeuseTrouvee" class="small muted">
            Saisissez un code vendeuse valide pour valider.
          </p>
        </div>
      </div>
    </div>

    <!-- Historique ------------------------------------------------------- -->
    <div v-else>
      <div class="grid grid-stats mb-4">
        <StatCard label="Ventes trouvees" :value="total" icon="receipt" tone="accent"
          :hint="filtreActif ? 'Sur la periode filtree' : 'Toutes periodes'" />
        <StatCard label="Total de la page" :value="formatMontant(totalAffiche)" icon="wallet" tone="success"
          :hint="`${ventes.length} vente(s) affichee(s)`" />
        <StatCard label="Panier moyen" :value="formatMontant(panierMoyen)" icon="trending"
          hint="Sur les ventes affichees" />
      </div>

      <div class="card">
        <div class="card-head">
          <div class="toolbar" style="width: 100%">
            <div class="field">
              <label>Du</label>
              <input v-model="filtres.from" type="date" />
            </div>
            <div class="field">
              <label>Au</label>
              <input v-model="filtres.to" type="date" />
            </div>
            <div class="field" style="min-width: 180px">
              <label>Vendeuse</label>
              <select v-model="filtres.vendeuse_id">
                <option value="">Toutes</option>
                <option v-for="v in vendeuses" :key="v.id" :value="v.id">{{ v.nom }}</option>
              </select>
            </div>
            <button type="button" class="primary" @click="filtrerVentes">
              <Icon name="filter" :size="15" /> Filtrer
            </button>
            <button v-if="filtreActif" type="button" class="btn-ghost" @click="reinitialiserFiltres">
              Reinitialiser
            </button>
          </div>
        </div>

        <div class="card-body card-body-flush">
          <TableSkeleton v-if="loading || chargementVentes" :rows="6" :cols="4" />

          <EmptyState
            v-else-if="!ventes.length && filtreActif"
            icon="search"
            title="Aucune vente sur cette periode"
            desc="Elargissez les dates ou retirez le filtre vendeuse pour voir plus de resultats."
          >
            <button type="button" @click="reinitialiserFiltres">Reinitialiser les filtres</button>
          </EmptyState>

          <EmptyState
            v-else-if="!ventes.length"
            icon="receipt"
            title="Aucune vente enregistree"
            desc="Les ventes validees a la caisse apparaissent ici, avec leur detail ligne par ligne."
          >
            <button type="button" class="primary" @click="ongletActif = 'caisse'">
              <Icon name="cart" :size="15" /> Enregistrer une vente
            </button>
          </EmptyState>

          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vente</th>
                  <th>Attribuee a</th>
                  <th class="td-num">Montant</th>
                  <th class="td-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="v in ventes" :key="v.id">
                  <td>
                    <div class="td-strong nowrap">{{ formatDate(v.date) }}</div>
                    <div class="small muted">
                      <span v-if="v.numero_facture" class="nowrap">{{ v.numero_facture }}</span>
                      <span v-else>#{{ v.id }}</span>
                    </div>
                  </td>
                  <td>
                    <span class="badge" :class="v.type === 'directe' ? 'info' : 'accent'">
                      <Icon :name="v.type === 'directe' ? 'building' : 'users'" :size="12" />
                      {{ v.type === 'directe' ? 'Boutique' : v.vendeuse_nom }}
                    </span>
                  </td>
                  <td class="td-num td-strong tnum">{{ formatMontant(v.montant_total) }}</td>
                  <td class="td-actions">
                    <button type="button" class="btn-sm btn-ghost" title="Detail" @click="ouvrirDetail(v)">
                      <Icon name="eye" :size="15" />
                    </button>
                    <!-- Le bouton n'apparait que sur les ventes qui portent un
                         numero. Une vente enregistree avant l'activation de la
                         facturation n'en a pas, et n'en recevra pas apres coup :
                         lui donner un numero de la serie courante l'intercalerait
                         au milieu de factures posterieures. -->
                    <button
                      v-if="v.numero_facture"
                      type="button"
                      class="btn-sm btn-ghost"
                      :title="`Facture ${v.numero_facture}`"
                      :disabled="factureEnCours === v.id"
                      @click="telechargerFacture(v)"
                    >
                      <span v-if="factureEnCours === v.id" class="spinner" />
                      <Icon v-else name="receipt" :size="15" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card-foot">
          <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="changerPage" />
        </div>
      </div>
    </div>

    <!-- Detail d'une vente -->
    <Modal v-if="detailVisible" title="Detail de la vente" @close="detailVisible = false">
      <TableSkeleton v-if="detailChargement" :rows="3" :cols="4" />
      <template v-else-if="detailVente">
        <div class="row wrap mb-3" style="gap: 8px">
          <span class="badge" :class="detailVente.type === 'directe' ? 'info' : 'accent'">
            <Icon :name="detailVente.type === 'directe' ? 'building' : 'users'" :size="12" />
            {{ detailVente.type === 'directe' ? 'Boutique' : detailVente.vendeuse_nom }}
          </span>
          <span class="small muted">{{ formatDate(detailVente.date) }}</span>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th class="td-num">Qte</th>
                <th class="td-num">Prix</th>
                <th class="td-num">Sous-total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in detailVente.lignes" :key="l.id">
                <td class="td-strong">{{ l.produit_nom }}</td>
                <td class="td-num tnum">{{ formatQuantite(l.quantite) }}</td>
                <td class="td-num tnum muted">{{ formatMontant(l.prix_vente_snapshot) }}</td>
                <td class="td-num tnum td-strong">
                  {{ formatMontant(l.prix_vente_snapshot * l.quantite) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="row-between mt-4">
          <span class="stat-label">Total</span>
          <span class="total-montant tnum">{{ formatMontant(detailVente.montant_total) }}</span>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
/* Ecran de caisse : catalogue a gauche, panier a droite et visible en
   permanence sur grand ecran pour verifier ce qu'on encaisse. */
.caisse {
  display: grid;
  gap: 16px;
  /* minmax(0, 1fr) et non 1fr : `1fr` vaut `minmax(auto, 1fr)`, dont la borne
     basse est la largeur mini du contenu. Sur un ecran etroit, la colonne
     refuse alors de retrecir et fait deborder toute la page. */
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}
@media (min-width: 1040px) {
  .caisse { grid-template-columns: minmax(0, 1fr) minmax(340px, 400px); }
  .panier { position: sticky; top: calc(var(--topbar-h) + 16px); }
}

.picker { list-style: none; margin: 0; padding: 0; max-height: 340px; overflow-y: auto; }
.picker-item {
  width: 100%;
  border: none;
  border-radius: 0;
  border-bottom: 1px solid var(--border);
  background: none;
  justify-content: flex-start;
  gap: 10px;
  padding: 10px 14px;
  text-align: left;
}
.picker-item:hover:not(:disabled) { background: var(--bg-subtle); border-color: var(--border); }
.picker-item.is-active { background: var(--accent-soft); }
.picker-item.is-active .picker-name { color: var(--accent-text); }
.picker-name { flex: 1; min-width: 0; font-weight: 550; color: var(--text-h); overflow: hidden; text-overflow: ellipsis; }
.picker-price { color: var(--text-muted); font-size: 12.5px; }

/* Quantite : deux boutons encadrent le champ. Le champ reste editable pour les
   grosses quantites, mais l'ajustement au doigt passe par les boutons. */
.qte-ctrl { display: flex; align-items: center; gap: 3px; }
.qte-ctrl > button {
  padding: 0;
  width: 32px;
  min-width: 32px;
  flex-shrink: 0;
  font-size: 17px;
  font-weight: 650;
  line-height: 1;
}
.qte-input { padding: 5px 4px; text-align: center; font-variant-numeric: tabular-nums; min-width: 0; }

/* Surlignage bref de la ligne qu'on vient d'ajouter : sur un panier long, on
   ne sait pas ou l'article a atterri sans ce repere. */
tbody tr.is-ajoutee { animation: ligne-ajoutee 1s ease-out; }
@keyframes ligne-ajoutee {
  from { background: var(--accent-soft); }
  to { background: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  tbody tr.is-ajoutee { animation: none; background: var(--accent-soft); }
}

.code-input {
  font-family: var(--mono);
  font-size: 19px;
  letter-spacing: 0.28em;
  text-align: center;
}

.total-foot { flex-direction: column; align-items: stretch; gap: 10px; }
.total-montant {
  font-size: 24px;
  font-weight: 680;
  color: var(--text-h);
  letter-spacing: -0.025em;
}
</style>

<style scoped>
/* -----------------------------------------------------------------------------
   Selection des produits en cartes.

   En caisse, on reconnait un article a son flacon bien avant de lire son nom.
   Vingt references dont les libelles ne different que par un parfum ou un
   volume se confondent en liste ; avec la photo et le prix en gros, la
   personne qui vend verifie d'un coup d'oeil qu'elle tient le bon article.
   ----------------------------------------------------------------------------- */

.barre-rayons {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  /* Le defilement horizontal reste dans la barre : le corps de page ne doit
     jamais partir de cote sur un petit ecran. */
  scrollbar-width: thin;
}

.puce-rayon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-card);
  font-size: 0.8125rem;
  color: var(--text);
  cursor: pointer;
}

.puce-rayon:hover { border-color: var(--primary); }

.puce-rayon.is-active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.puce-compte {
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  opacity: 0.72;
}

.grille-produits {
  display: grid;
  /* minmax(0, …) et non une largeur libre : sans le 0, un nom long empeche la
     colonne de retrecir et toute la grille deborde. */
  grid-template-columns: repeat(auto-fill, minmax(min(148px, 100%), 1fr));
  gap: 10px;
  padding: 14px;
}

.carte-produit {
  display: flex;
  flex-direction: column;
  gap: 5px;
  /* Sans ceci, un element interne plus large que la carte l'empeche de
     retrecir : `min-width` vaut `auto` par defaut sur un element de grille. */
  min-width: 0;
  /* La carte est un <button>, et la regle globale des boutons impose
     `white-space: nowrap` - ce qui s'herite. Sans cette remise a zero, le nom
     du produit ne passe jamais a la ligne : il est rogne au bord de la carte,
     et « Apres-shampooing nourrissant 400 mL » s'affiche « Apres-shampooing
     nourris ». */
  white-space: normal;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-card);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s, box-shadow 0.14s, transform 0.14s;
}

.carte-produit:hover {
  border-color: var(--primary);
  transform: translateY(-1px);
}

.carte-produit.is-active {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 28%, transparent);
}

/* Un article a zero reste visible et cliquable : la personne qui vend doit
   pouvoir constater qu'il est epuise, pas se demander ou il est passe. */
.carte-produit.est-epuise { opacity: 0.55; }

.carte-visuel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  /* La carte est un conteneur flex en colonne : sans cela l'image se laisse
     comprimer en hauteur des que le nom prend deux lignes, et la pastille de
     stock posee en bas se retrouve coupee par le `overflow: hidden`. */
  flex-shrink: 0;
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
  overflow: hidden;
}

.carte-visuel img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.carte-stock {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  /* Fond opaque : pose sur une photo, un badge translucide devient illisible
     des que le cliche est clair. */
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text);
  max-width: calc(100% - 8px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.carte-stock.danger { color: var(--danger); border-color: var(--danger); }
.carte-stock.success { color: var(--success); border-color: var(--success); }

.carte-coche {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
}

.carte-nom {
  font-size: 0.8125rem;
  line-height: 1.3;
  color: var(--text-h);
  /* `max-width` et non `min-width: 0` : la carte est un conteneur flex en
     colonne, donc la largeur du nom est sa taille TRANSVERSALE, et flex-shrink
     n'agit que sur l'axe principal. Sans cette borne, un libelle comme « Encens
     Bakhour Al Haramain (au gramme) » impose sa largeur naturelle - mesure a
     390 px : 238 px de texte dans une carte de 153 px - et fait defiler toute
     la page de cote. */
  max-width: 100%;
  overflow-wrap: anywhere;
  /* Deux lignes maximum : au dela, les cartes de la meme rangee prennent des
     hauteurs differentes et la grille devient bancale.
     Uniquement la forme prefixee. La propriete standard `line-clamp` est
     desormais implementee par Chromium comme un raccourci qui pose
     `continue: discard` : l'element calcule alors `display: flow-root` au lieu
     de `-webkit-box`, le decoupage en lignes ne s'applique plus et le nom est
     rogne d'un seul trait au bord de la carte au lieu de passer a la ligne. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* Hauteur reservee a deux lignes : les prix restent alignes d'une carte a
     l'autre, qu'un nom tienne sur une ligne ou deux. */
  min-height: calc(2 * 1.3em);
}

.carte-classement {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 0.6875rem;
  line-height: 1.2;
  /* Meme raison que pour le nom : une marque au libelle long deborderait la
     carte sur l'axe transversal. */
  max-width: 100%;
}

.carte-marque,
.carte-rayon {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.carte-marque {
  padding: 1px 5px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: var(--primary);
  font-weight: 600;
}

.carte-rayon { color: var(--text-muted); padding: 1px 0; }

.carte-prix {
  margin-top: auto;
  font-size: 0.9375rem;
  font-weight: 680;
  color: var(--text-h);
  letter-spacing: -0.02em;
}

/* Ecrans tactiles et petits ecrans : des cartes plus grandes, donc des cibles
   plus sures, et deux colonnes qui restent lisibles sur un telephone. */
@media (pointer: coarse), (max-width: 700px) {
  .grille-produits {
    grid-template-columns: repeat(auto-fill, minmax(min(132px, 100%), 1fr));
    gap: 9px;
    padding: 11px;
  }

  .puce-rayon { padding: 7px 13px; }
}
</style>
