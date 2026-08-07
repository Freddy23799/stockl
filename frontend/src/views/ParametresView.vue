<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api, { assetUrl } from '../api/client'
import { useModulesStore } from '../stores/modules'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import { useToastStore } from '../stores/toasts'
import { formatDateCourt } from '../utils/format'
import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import Modal from '../components/ui/Modal.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Icon from '../components/ui/Icon.vue'
import ScannerDocument from '../components/ui/ScannerDocument.vue'

const modules = useModulesStore()
const auth = useAuthStore()
const theme = useThemeStore()
const toasts = useToastStore()

const parametres = ref(null)
const utilisateurs = ref([])
const loading = ref(true)
const erreur = ref('')

const ongletActif = ref('general')

const onglets = computed(() => [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'etablissement', label: 'Etablissement', icon: 'building' },
  { id: 'modules', label: 'Modules', icon: 'toggle' },
  { id: 'securite', label: 'Securite', icon: 'shield' },
  { id: 'verification', label: 'Verification', icon: 'scan' },
  { id: 'comptes', label: 'Comptes', icon: 'users', count: utilisateurs.value.length },
])

/* --- Identite de l'etablissement ---------------------------------------- */

// Ces informations n'ont qu'un seul consommateur : l'entete des documents
// imprimes. Un rapport remis a un banquier ou a un comptable doit porter le nom
// et les coordonnees de la structure, pas seulement des chiffres.
//
// Les champs sont groupes comme on les lit sur un en-tete de papier a lettre,
// et non dans l'ordre des colonnes de la base.
const GROUPES_ETABLISSEMENT = [
  {
    titre: 'Identite',
    desc: "Apparait en haut de chaque document, a cote du logo.",
    champs: [
      { cle: 'etablissement_nom', label: "Nom de l'etablissement", obligatoire: true, large: true },
      { cle: 'etablissement_slogan', label: 'Slogan', aide: 'Facultatif, en italique sous le nom' },
      { cle: 'etablissement_activite', label: "Secteur d'activite", aide: 'Ex. Vente de parfums et cosmetiques' },
    ],
  },
  {
    titre: 'Localisation',
    desc: "Composee sur une seule ligne dans l'entete, les champs vides sont ignores.",
    champs: [
      { cle: 'etablissement_adresse', label: 'Adresse', large: true },
      { cle: 'etablissement_quartier', label: 'Quartier' },
      { cle: 'etablissement_ville', label: 'Ville' },
      { cle: 'etablissement_pays', label: 'Pays' },
      { cle: 'etablissement_boite_postale', label: 'Boite postale' },
    ],
  },
  {
    titre: 'Contact',
    champs: [
      { cle: 'etablissement_telephone', label: 'Telephone principal', type: 'tel' },
      { cle: 'etablissement_telephone_2', label: 'Telephone secondaire', type: 'tel' },
      { cle: 'etablissement_email', label: 'Adresse email', type: 'email' },
      { cle: 'etablissement_site_web', label: 'Site web' },
    ],
  },
  {
    titre: 'Mentions legales',
    desc: 'Imprimees en petits caracteres sous les coordonnees.',
    champs: [
      { cle: 'etablissement_registre_commerce', label: 'Registre du commerce' },
      { cle: 'etablissement_identifiant_fiscal', label: 'Identifiant fiscal' },
      { cle: 'etablissement_capital', label: 'Capital social' },
      { cle: 'devise', label: 'Devise', obligatoire: true, aide: 'Ex. FCFA, EUR' },
      {
        cle: 'etablissement_mention_pied',
        label: 'Mention de bas de page',
        large: true,
        aide: 'Reprise en pied de chaque page imprimee',
      },
    ],
  },
]

const CLES_ETABLISSEMENT = GROUPES_ETABLISSEMENT.flatMap((g) => g.champs.map((c) => c.cle))

const etablissement = reactive({})
const etablissementSoumission = ref(false)
const etablissementErreur = ref('')

function remplirEtablissement(source) {
  for (const cle of CLES_ETABLISSEMENT) {
    // `null` en base doit devenir une chaine vide : lie a un `<input>`, `null`
    // afficherait le texte "null" dans le champ.
    etablissement[cle] = source?.[cle] ?? ''
  }
}

// Vrai des qu'un champ differe de ce qui est enregistre : evite d'activer le
// bouton d'enregistrement quand il n'y a rien a enregistrer.
const etablissementModifie = computed(() =>
  CLES_ETABLISSEMENT.some((cle) => (etablissement[cle] ?? '') !== (parametres.value?.[cle] ?? ''))
)

async function enregistrerEtablissement() {
  etablissementSoumission.value = true
  etablissementErreur.value = ''
  try {
    const charge = Object.fromEntries(CLES_ETABLISSEMENT.map((cle) => [cle, etablissement[cle]]))
    const { data } = await api.put('/parametres', charge)
    parametres.value = data
    remplirEtablissement(data)
    toasts.succes("Identite de l'etablissement enregistree")
  } catch (err) {
    etablissementErreur.value = err.response?.data?.message || 'Erreur lors de l\'enregistrement'
  } finally {
    etablissementSoumission.value = false
  }
}

function annulerEtablissement() {
  remplirEtablissement(parametres.value)
  etablissementErreur.value = ''
}

async function charger() {
  loading.value = true
  erreur.value = ''
  try {
    const [paramsRes, utilisateursRes] = await Promise.all([
      api.get('/parametres'),
      api.get('/utilisateurs'),
    ])
    parametres.value = paramsRes.data
    utilisateurs.value = utilisateursRes.data
    remplirEtablissement(paramsRes.data)
  } catch (err) {
    erreur.value = err.response?.data?.message || 'Erreur de chargement'
  } finally {
    loading.value = false
  }
}

onMounted(charger)

/* --- Modules ------------------------------------------------------------ */

const DESCRIPTION_MODULE = {
  module_ventes: {
    titre: 'Ventes et vendeuses',
    desc: 'Enregistrement des ventes, attribution aux vendeuses, chiffre d\'affaires dans les rapports.',
  },
  module_fournisseurs: {
    titre: 'Fournisseurs',
    desc: 'Rattachement des entrees de stock a un fournisseur et suivi des achats par source.',
  },
  module_depenses: {
    titre: 'Depenses',
    desc: 'Saisie des charges hors marchandise et leur deduction du bilan net.',
  },
  module_employes: {
    titre: 'Employes',
    desc: 'Dossiers du personnel : identite, historique de carriere, pieces justificatives. '
      + 'Les vendeuses s\'y rattachent : sans ce module, aucun nouveau code de vente ne peut etre attribue.',
  },
  module_paie: {
    titre: 'Paie',
    desc: 'Fiches de paie par periode, versements, recus a numero unique et statistiques. '
      + 'S\'appuie sur les fiches employes.',
  },
  module_badges: {
    titre: 'Badges',
    desc: 'Impression des cartes professionnelles avec photo, matricule et QR de verification.',
  },
}

// Sous-options : elles dependent d'un module et n'apparaissent que s'il est
// actif. La facturation n'est pas un module a part - une facture n'a de sens
// que la ou il y a des ventes - et l'activer separement n'aurait rien voulu
// dire.
const SOUS_OPTIONS = {
  module_ventes: [
    {
      champ: 'module_factures',
      titre: 'Facture automatique',
      desc: 'Chaque vente recoit un numero de facture a son enregistrement, et la facture se '
        + "telecharge depuis l'historique. La numerotation repart a 1 chaque annee. Les ventes "
        + "deja enregistrees ne recoivent pas de numero apres coup : le leur donner les "
        + 'intercalerait au milieu de factures posterieures.',
    },
  ],
}

// Le scanner n'est monte qu'a l'ouverture : le composant demande la camera des
// son montage, et la reclamer au chargement de la page serait intrusif.
const scannerVisible = ref(false)

const moduleEnCours = ref(null)
const moduleADesactiver = ref(null)

async function appliquerModule(champ, valeur) {
  moduleEnCours.value = champ
  try {
    const { data } = await api.put('/parametres', { [champ]: valeur })
    parametres.value = data
    await modules.charger()
    toasts.succes(`${DESCRIPTION_MODULE[champ].titre} ${valeur ? 'active' : 'desactive'}`)
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur lors du changement de module')
    // Retour visuel a l'etat precedent si le serveur a refuse.
    parametres.value[champ] = !valeur
  } finally {
    moduleEnCours.value = null
    moduleADesactiver.value = null
  }
}

// Activer est sans risque ; desactiver fait disparaitre des pages entieres de
// l'interface, donc on demande confirmation dans ce sens uniquement.
function basculerModule(champ) {
  const valeur = !parametres.value[champ]
  if (!valeur) {
    moduleADesactiver.value = champ
    return
  }
  appliquerModule(champ, true)
}

/**
 * Bascule d'une sous-option.
 *
 * Sans confirmation dans les deux sens, contrairement aux modules : eteindre la
 * facturation ne fait disparaitre aucune page ni aucune donnee. Les ventes deja
 * numerotees gardent leur numero et leur facture reste imprimable ; seules les
 * ventes suivantes n'en recevront plus.
 */
async function basculerSousOption(sous) {
  const valeur = !parametres.value[sous.champ]
  moduleEnCours.value = sous.champ
  try {
    const { data } = await api.put('/parametres', { [sous.champ]: valeur })
    parametres.value = data
    toasts.succes(`${sous.titre} ${valeur ? 'activee' : 'desactivee'}`)
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur lors du changement')
    parametres.value[sous.champ] = !valeur
  } finally {
    moduleEnCours.value = null
  }
}

/* --- Methode de valorisation -------------------------------------------- */

const methodeSoumission = ref(false)

async function changerMethode(valeur) {
  if (valeur === parametres.value.methode_valorisation) return
  methodeSoumission.value = true
  try {
    const { data } = await api.put('/parametres', { methode_valorisation: valeur })
    parametres.value = data
    toasts.succes(`Valorisation du stock : ${valeur}`)
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  } finally {
    methodeSoumission.value = false
  }
}

/* --- Logo --------------------------------------------------------------- */

const logoFichier = ref(null)
const logoApercu = ref('')
const logoEnvoi = ref(false)

function surChoixLogo(e) {
  const f = e.target.files[0] || null
  logoFichier.value = f
  logoApercu.value = f ? URL.createObjectURL(f) : ''
}

async function envoyerLogo() {
  if (!logoFichier.value) return
  logoEnvoi.value = true
  try {
    const formData = new FormData()
    formData.append('logo', logoFichier.value)
    const { data } = await api.post('/parametres/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    parametres.value = data
    logoFichier.value = null
    logoApercu.value = ''
    toasts.succes('Logo mis a jour')
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur lors de l\'envoi du logo')
  } finally {
    logoEnvoi.value = false
  }
}

/* --- Mot de passe ------------------------------------------------------- */

const motDePasseVisible = ref(false)
const motDePasseForm = reactive({ actuel: '', nouveau: '', confirmation: '' })
const motDePasseErreur = ref('')
const motDePasseSoumission = ref(false)

// Indicateur de robustesse purement indicatif : la regle qui fait autorite est
// celle du serveur (8 caracteres minimum).
const forceMotDePasse = computed(() => {
  const v = motDePasseForm.nouveau
  if (!v) return null
  let score = 0
  if (v.length >= 8) score += 1
  if (v.length >= 12) score += 1
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score += 1
  if (/[0-9]/.test(v)) score += 1
  if (/[^A-Za-z0-9]/.test(v)) score += 1
  if (score <= 2) return { niveau: 'Faible', part: 33, ton: 'danger' }
  if (score <= 3) return { niveau: 'Moyen', part: 66, ton: 'warning' }
  return { niveau: 'Solide', part: 100, ton: 'success' }
})

const concordance = computed(() => {
  if (!motDePasseForm.confirmation) return null
  return motDePasseForm.nouveau === motDePasseForm.confirmation
})

function ouvrirMotDePasse() {
  Object.assign(motDePasseForm, { actuel: '', nouveau: '', confirmation: '' })
  motDePasseErreur.value = ''
  motDePasseVisible.value = true
}

async function changerMotDePasse() {
  if (motDePasseForm.nouveau !== motDePasseForm.confirmation) {
    motDePasseErreur.value = 'Les deux nouveaux mots de passe ne correspondent pas.'
    return
  }
  motDePasseSoumission.value = true
  motDePasseErreur.value = ''
  try {
    const { data } = await api.patch('/utilisateurs/moi/mot-de-passe', {
      mot_de_passe_actuel: motDePasseForm.actuel,
      nouveau_mot_de_passe: motDePasseForm.nouveau,
    })
    // Jeton renouvele sur place : la session continue, aucun retour a l'ecran
    // de connexion et rien a ressaisir.
    auth.setSession(data.token, data.user)
    motDePasseVisible.value = false
    toasts.succes('Mot de passe modifie. Votre session reste ouverte.')
  } catch (err) {
    motDePasseErreur.value = err.response?.data?.message || 'Erreur lors du changement de mot de passe'
  } finally {
    motDePasseSoumission.value = false
  }
}

/* --- Comptes ------------------------------------------------------------ */

const compteVisible = ref(false)
const compteForm = reactive({ prenom: '', nom: '' })
const compteErreur = ref('')
const compteSoumission = ref(false)
// Identifiant + mot de passe generes, montres UNE SEULE FOIS apres creation.
// Le mot de passe n'est stocke qu'en hash cote serveur : une fois cet encart
// ferme, il est definitivement irrecuperable.
const compteCree = ref(null)

function ouvrirCompte() {
  Object.assign(compteForm, { prenom: '', nom: '' })
  compteErreur.value = ''
  compteCree.value = null
  compteVisible.value = true
}

async function creerCompte() {
  compteSoumission.value = true
  compteErreur.value = ''
  try {
    const { data } = await api.post('/utilisateurs', compteForm)
    compteCree.value = {
      nom_utilisateur: data.nom_utilisateur,
      mot_de_passe: data.mot_de_passe_initial,
      personne: `${data.prenom} ${data.nom}`,
    }
    await charger()
  } catch (err) {
    compteErreur.value = err.response?.data?.message || 'Erreur lors de la creation du compte'
  } finally {
    compteSoumission.value = false
  }
}

function fermerCompte() {
  compteCree.value = null
  compteVisible.value = false
}

const aDesactiver = ref(null)
const desactivationEnCours = ref(false)

async function confirmerDesactivation() {
  desactivationEnCours.value = true
  try {
    await api.patch(`/utilisateurs/${aDesactiver.value.id}/desactiver`)
    toasts.succes(`Compte de ${aDesactiver.value.prenom} ${aDesactiver.value.nom} desactive`)
    aDesactiver.value = null
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur')
  } finally {
    desactivationEnCours.value = false
  }
}

// Deblocage. Porte l'id du compte en cours de traitement plutot qu'un booleen :
// c'est ce qui permet de n'afficher le sablier que sur la ligne concernee.
const reactivationEnCours = ref(null)

async function reactiver(utilisateur) {
  reactivationEnCours.value = utilisateur.id
  try {
    await api.patch(`/utilisateurs/${utilisateur.id}/reactiver`)
    toasts.succes(`Compte de ${utilisateur.prenom} ${utilisateur.nom} debloque`)
    await charger()
  } catch (err) {
    toasts.erreur(err.response?.data?.message || 'Erreur lors du deblocage')
  } finally {
    reactivationEnCours.value = null
  }
}

async function copier(texte, libelle) {
  try {
    await navigator.clipboard.writeText(texte)
    toasts.succes(`${libelle} copie`)
  } catch {
    toasts.erreur('Copie impossible sur ce navigateur')
  }
}
</script>

<template>
  <div>
    <PageHeader title="Parametres" subtitle="Configuration de la boutique, des modules actifs et des comptes administrateurs." />

    <p v-if="erreur" class="alert alert-danger mb-4">
      <Icon name="alert" :size="16" /><span>{{ erreur }}</span>
    </p>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div class="skeleton" style="width: 30%; height: 18px" />
        <div class="skeleton" style="width: 80%" />
        <div class="skeleton" style="width: 65%" />
      </div>
    </div>

    <template v-else-if="parametres">
      <Tabs v-model="ongletActif" :tabs="onglets" />

      <!-- ============ General ============ -->
      <div v-show="ongletActif === 'general'" class="stack">
        <div class="card">
          <div class="card-head">
            <div class="card-head-text">
              <h2>Logo de la boutique</h2>
              <p class="card-head-sub">Affiche en en-tete des documents et des rapports imprimes</p>
            </div>
          </div>
          <div class="card-body">
            <div class="row wrap" style="gap: 16px; align-items: flex-start">
              <img
                :src="logoApercu || assetUrl(parametres.logo_path, { taille: 'moyen' })"
                class="thumb thumb-lg"
                alt="Logo actuel"
              />
              <div class="field flex-1" style="min-width: 220px">
                <label>Remplacer le logo</label>
                <!-- PNG et JPEG seulement : ce sont les deux seuls formats
                     embarquables dans un PDF, et ce logo doit s'imprimer en
                     entete de tous les rapports. -->
                <input type="file" accept="image/png,image/jpeg" @change="surChoixLogo" />
                <span class="field-hint">
                  PNG ou JPG — 5 Mo maximum. Ces formats sont les seuls qui s'impriment
                  en entete des rapports PDF.
                </span>
              </div>
              <button
                type="button"
                class="primary"
                :disabled="!logoFichier || logoEnvoi"
                @click="envoyerLogo"
              >
                <span v-if="logoEnvoi" class="spinner" />
                Enregistrer
              </button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-head-text">
              <h2>Valorisation du stock</h2>
              <p class="card-head-sub">Determine le cout d'acquisition applique a chaque vente</p>
            </div>
          </div>
          <div class="card-body stack">
            <label
              class="switch-row"
              :class="{ 'is-on': parametres.methode_valorisation === 'CMP' }"
              @click.prevent="changerMethode('CMP')"
            >
              <input type="radio" :checked="parametres.methode_valorisation === 'CMP'" :disabled="methodeSoumission" />
              <span class="switch-text">
                <span class="switch-title">Cout moyen pondere (CMP)</span>
                <span class="switch-desc">
                  Toutes les entrees d'un produit sont moyennees. Simple a suivre, lisse les variations de prix d'achat.
                </span>
              </span>
            </label>
            <label
              class="switch-row"
              :class="{ 'is-on': parametres.methode_valorisation === 'FIFO' }"
              @click.prevent="changerMethode('FIFO')"
            >
              <input type="radio" :checked="parametres.methode_valorisation === 'FIFO'" :disabled="methodeSoumission" />
              <span class="switch-text">
                <span class="switch-title">Premier entre, premier sorti (FIFO)</span>
                <span class="switch-desc">
                  Chaque vente consomme les lots les plus anciens a leur cout reel. Plus fidele quand les prix bougent.
                </span>
              </span>
            </label>
            <p class="alert alert-info">
              <Icon name="info" :size="16" />
              <span>
                Les ventes deja enregistrees gardent le cout fige au moment ou elles ont eu lieu.
                Changer de methode n'affecte que les ventes a venir.
              </span>
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-head-text">
              <h2>Apparence</h2>
              <p class="card-head-sub">Preference enregistree sur cet appareil uniquement</p>
            </div>
          </div>
          <div class="card-body">
            <div class="row-between wrap">
              <div>
                <p class="strong">Theme {{ theme.theme === 'dark' ? 'sombre' : 'clair' }}</p>
                <p class="small muted mt-2">Le theme suit votre systeme tant que vous ne choisissez pas.</p>
              </div>
              <button type="button" @click="theme.basculer()">
                <Icon :name="theme.theme === 'dark' ? 'sun' : 'moon'" :size="15" />
                Passer en {{ theme.theme === 'dark' ? 'clair' : 'sombre' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ Etablissement ============ -->
      <div v-show="ongletActif === 'etablissement'" class="stack">
        <div class="card">
          <div class="card-body row" style="align-items: flex-start; gap: 12px">
            <span class="stat-icon is-accent"><Icon name="info" :size="15" /></span>
            <div class="flex-1">
              <p class="strong">Ces informations composent l'entete de vos documents</p>
              <p class="small muted mt-2">
                Elles apparaissent en haut de chaque rapport PDF, a cote du logo. Tout est
                facultatif sauf le nom et la devise : les champs laisses vides sont simplement
                omis de l'entete, sans laisser de ligne blanche.
              </p>
            </div>
          </div>
        </div>

        <form class="stack" @submit.prevent="enregistrerEtablissement">
          <div v-for="groupe in GROUPES_ETABLISSEMENT" :key="groupe.titre" class="card">
            <div class="card-head">
              <div class="card-head-text">
                <h2>{{ groupe.titre }}</h2>
                <p v-if="groupe.desc" class="card-head-sub">{{ groupe.desc }}</p>
              </div>
            </div>
            <div class="card-body">
              <div class="grid-champs">
                <div
                  v-for="champ in groupe.champs"
                  :key="champ.cle"
                  class="field"
                  :class="{ 'champ-large': champ.large }"
                >
                  <label :for="champ.cle">
                    {{ champ.label }}
                    <span v-if="champ.obligatoire" class="champ-requis" aria-hidden="true">*</span>
                  </label>
                  <textarea
                    v-if="champ.cle === 'etablissement_mention_pied'"
                    :id="champ.cle"
                    v-model="etablissement[champ.cle]"
                    rows="2"
                    maxlength="300"
                  />
                  <input
                    v-else
                    :id="champ.cle"
                    v-model="etablissement[champ.cle]"
                    :type="champ.type || 'text'"
                    :required="champ.obligatoire"
                    autocomplete="off"
                  />
                  <span v-if="champ.aide" class="field-hint">{{ champ.aide }}</span>
                </div>
              </div>
            </div>
          </div>

          <p v-if="etablissementErreur" class="alert alert-danger">
            <Icon name="alert" :size="16" /><span>{{ etablissementErreur }}</span>
          </p>

          <div class="card">
            <div class="card-body row-between wrap" style="gap: 10px">
              <span class="small muted">
                {{ etablissementModifie ? 'Modifications non enregistrees' : 'Tout est enregistre' }}
              </span>
              <div class="row" style="gap: 8px">
                <button
                  v-if="etablissementModifie"
                  type="button"
                  class="btn-ghost"
                  @click="annulerEtablissement"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  class="primary"
                  :disabled="etablissementSoumission || !etablissementModifie"
                >
                  <span v-if="etablissementSoumission" class="spinner" />
                  <Icon v-else name="check" :size="15" />
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      <!-- ============ Modules ============ -->
      <div v-show="ongletActif === 'modules'" class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Modules actifs</h2>
            <p class="card-head-sub">
              Un module desactive disparait entierement de l'interface et ses routes sont bloquees,
              meme en acces direct. Rien n'est supprime : tout revient tel quel a la reactivation.
            </p>
          </div>
        </div>
        <div class="card-body stack">
          <template v-for="(info, champ) in DESCRIPTION_MODULE" :key="champ">
            <div
              class="switch-row"
              :class="{ 'is-on': parametres[champ] }"
              @click="basculerModule(champ)"
            >
              <span class="switch-text">
                <span class="switch-title">{{ info.titre }}</span>
                <span class="switch-desc">{{ info.desc }}</span>
              </span>
              <button
                type="button"
                class="switch"
                :class="{ 'is-on': parametres[champ] }"
                :disabled="moduleEnCours === champ"
                :aria-label="`Basculer ${info.titre}`"
                @click.stop="basculerModule(champ)"
              />
            </div>

            <!-- Sous-options du module, en retrait et seulement s'il est actif :
                 proposer la facturation alors que les ventes sont eteintes
                 n'aurait aucun sens. -->
            <div
              v-for="sous in (parametres[champ] ? (SOUS_OPTIONS[champ] || []) : [])"
              :key="sous.champ"
              class="switch-row switch-sous"
              :class="{ 'is-on': parametres[sous.champ] }"
              @click="basculerSousOption(sous)"
            >
              <span class="switch-text">
                <span class="switch-title">
                  <Icon name="arrowRight" :size="13" /> {{ sous.titre }}
                </span>
                <span class="switch-desc">{{ sous.desc }}</span>
              </span>
              <button
                type="button"
                class="switch"
                :class="{ 'is-on': parametres[sous.champ] }"
                :disabled="moduleEnCours === sous.champ"
                :aria-label="`Basculer ${sous.titre}`"
                @click.stop="basculerSousOption(sous)"
              />
            </div>
          </template>

          <p class="alert alert-info">
            <Icon name="info" :size="16" />
            <span>
              Produits, Stock, Rapports, Historique et Parametres sont les fondations du systeme :
              ils restent toujours actifs.
            </span>
          </p>
        </div>
      </div>

      <!-- ============ Securite ============ -->
      <div v-show="ongletActif === 'securite'" class="stack">
        <div class="card">
          <div class="card-head">
            <div class="card-head-text">
              <h2>Mon mot de passe</h2>
              <p class="card-head-sub">Connecte en tant que {{ auth.user?.nom_utilisateur }}</p>
            </div>
            <button type="button" class="primary" @click="ouvrirMotDePasse">
              <Icon name="key" :size="15" /> Changer
            </button>
          </div>
          <div class="card-body">
            <p class="alert alert-warning">
              <Icon name="warning" :size="16" />
              <span>
                Le compte livre a l'installation utilise un mot de passe par defaut, identique sur
                toutes les installations et connu de quiconque a acces au code. Changez-le des la
                premiere connexion.
              </span>
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-head-text">
              <h2>Sessions</h2>
              <p class="card-head-sub">Comment les acces sont revoques</p>
            </div>
          </div>
          <div class="card-body stack">
            <div class="row" style="align-items: flex-start; gap: 12px">
              <span class="stat-icon is-success"><Icon name="shield" :size="15" /></span>
              <div class="flex-1">
                <p class="strong">Changer de mot de passe ferme les autres sessions</p>
                <p class="small muted mt-2">
                  Toute session ouverte ailleurs (autre poste, autre navigateur) est immediatement
                  invalidee. La session courante, elle, reste ouverte.
                </p>
              </div>
            </div>
            <div class="row" style="align-items: flex-start; gap: 12px">
              <span class="stat-icon is-success"><Icon name="shield" :size="15" /></span>
              <div class="flex-1">
                <p class="strong">Un compte desactive perd l'acces immediatement</p>
                <p class="small muted mt-2">
                  L'etat du compte est revalide a chaque requete, sans attendre l'expiration du jeton.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ Verification ============ -->
      <div v-show="ongletActif === 'verification'" class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Verifier un document</h2>
            <p class="card-head-sub">
              Badges et recus de paie portent un QR signe par le serveur. Le scanner dit s'il
              a bien ete produit par ce systeme, et ce qu'il designe.
            </p>
          </div>
        </div>
        <div class="card-body stack" style="gap: 16px">
          <div class="explication-scan">
            <span class="stat-icon is-accent"><Icon name="qr" :size="17" /></span>
            <div>
              <p class="strong">Comment ca marche</p>
              <p class="small muted mt-1">
                Le QR ne contient pas seulement un numero : il porte une empreinte calculee
                avec un secret qui ne quitte jamais le serveur. Personne ne peut donc en
                fabriquer un, meme en connaissant le matricule inscrit dessus. Le scanner
                verifie aussi que le document designe existe encore : un badge signe reste
                mathematiquement valide apres le depart de son titulaire, ce qui serait
                trompeur au controle d'une entree.
              </p>
            </div>
          </div>

          <div class="row wrap" style="gap: 10px">
            <button type="button" class="primary" @click="scannerVisible = true">
              <Icon name="scan" :size="15" /> Ouvrir le scanner
            </button>
          </div>

          <p class="alert alert-info">
            <Icon name="info" :size="16" />
            <span>
              La lecture se fait entierement sur cet appareil : aucune image n'est envoyee,
              seul le texte du code lu part au serveur pour verification.
            </span>
          </p>
        </div>
      </div>

      <!-- ============ Comptes ============ -->
      <div v-show="ongletActif === 'comptes'" class="card">
        <div class="card-head">
          <div class="card-head-text">
            <h2>Comptes administrateurs</h2>
            <p class="card-head-sub">
              Seuls les administrateurs se connectent. Les vendeuses sont identifiees par leur code a
              6 chiffres, sans compte.
            </p>
          </div>
          <button type="button" class="primary" @click="ouvrirCompte">
            <Icon name="userPlus" :size="15" /> Nouveau compte
          </button>
        </div>

        <div class="card-body card-body-flush">
          <EmptyState v-if="!utilisateurs.length" icon="users" title="Aucun compte" desc="Aucun compte administrateur n'existe." />
          <div v-else class="table-wrap">
            <table class="table-cards">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>Identifiant</th>
                  <th>Statut</th>
                  <th class="td-num hide-sm">Cree le</th>
                  <th class="td-actions"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in utilisateurs" :key="u.id">
                  <td data-label="Personne" class="td-titre">
                    <div class="row" style="gap: 9px">
                      <span class="avatar">{{ ((u.prenom || '')[0] || '') + ((u.nom || '')[0] || '') }}</span>
                      <span>
                        <span class="td-strong">{{ u.prenom }} {{ u.nom }}</span>
                        <span v-if="u.id === auth.user?.id" class="badge accent" style="margin-left: 6px">Vous</span>
                      </span>
                    </div>
                  </td>
                  <td data-label="Identifiant"><code class="strong">{{ u.nom_utilisateur }}</code></td>
                  <td data-label="Statut">
                    <span class="badge" :class="u.actif ? 'success' : 'danger'">
                      <span class="badge-dot" />{{ u.actif ? 'Actif' : 'Desactive' }}
                    </span>
                  </td>
                  <td data-label="Cree le" class="td-num small muted nowrap hide-sm">{{ formatDateCourt(u.created_at) }}</td>
                  <td data-label="" class="td-actions">
                    <!-- Le compte connecte n'expose aucune de ces deux actions :
                         se bloquer soi-meme fermerait la session en cours. Le
                         serveur refuse aussi le cas, l'interface ne fait que ne
                         pas proposer l'impasse. -->
                    <button
                      v-if="u.actif && u.id !== auth.user?.id"
                      type="button"
                      class="btn-sm btn-ghost"
                      title="Bloquer ce compte"
                      style="color: var(--danger)"
                      @click="aDesactiver = u"
                    >
                      <Icon name="toggle" :size="15" />
                    </button>
                    <button
                      v-else-if="!u.actif"
                      type="button"
                      class="btn-sm btn-ghost"
                      title="Debloquer ce compte"
                      style="color: var(--success)"
                      :disabled="reactivationEnCours === u.id"
                      @click="reactiver(u)"
                    >
                      <span v-if="reactivationEnCours === u.id" class="spinner" />
                      <Icon v-else name="check" :size="15" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ Modale mot de passe ============ -->
    <Modal v-if="motDePasseVisible" title="Changer mon mot de passe" @close="motDePasseVisible = false">
      <form id="form-mdp" @submit.prevent="changerMotDePasse">
        <div class="field">
          <label>Mot de passe actuel</label>
          <input v-model="motDePasseForm.actuel" type="password" required autocomplete="current-password" />
        </div>
        <div class="field">
          <label>Nouveau mot de passe</label>
          <input v-model="motDePasseForm.nouveau" type="password" required minlength="8" autocomplete="new-password" />
          <div v-if="forceMotDePasse" class="row mt-2" style="gap: 9px">
            <div class="jauge">
              <div
                class="jauge-remplissage"
                :style="{
                  width: `${forceMotDePasse.part}%`,
                  background: `var(--${forceMotDePasse.ton})`,
                }"
              />
            </div>
            <span class="small" :style="{ color: `var(--${forceMotDePasse.ton})` }">{{ forceMotDePasse.niveau }}</span>
          </div>
          <span v-else class="field-hint">8 caracteres minimum</span>
        </div>
        <div class="field">
          <label>Confirmer le nouveau mot de passe</label>
          <input v-model="motDePasseForm.confirmation" type="password" required minlength="8" autocomplete="new-password" />
          <span v-if="concordance === false" class="field-error">Les deux mots de passe ne correspondent pas</span>
          <span v-else-if="concordance === true" class="field-hint" style="color: var(--success)">Les mots de passe correspondent</span>
        </div>
        <p class="alert alert-info">
          <Icon name="info" :size="16" />
          <span>Vous resterez connecte. Les sessions ouvertes ailleurs seront fermees.</span>
        </p>
        <p v-if="motDePasseErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ motDePasseErreur }}</span>
        </p>
      </form>
      <template #footer>
        <button type="button" @click="motDePasseVisible = false">Annuler</button>
        <button type="submit" form="form-mdp" class="primary" :disabled="motDePasseSoumission">
          <span v-if="motDePasseSoumission" class="spinner" />
          Changer le mot de passe
        </button>
      </template>
    </Modal>

    <!-- ============ Modale nouveau compte ============ -->
    <Modal v-if="compteVisible" title="Nouveau compte administrateur" @close="fermerCompte">
      <form v-if="!compteCree" id="form-compte" @submit.prevent="creerCompte">
        <div class="field-row">
          <div class="field">
            <label>Prenom</label>
            <input v-model="compteForm.prenom" required />
          </div>
          <div class="field">
            <label>Nom</label>
            <input v-model="compteForm.nom" required />
          </div>
        </div>
        <p class="alert alert-info">
          <Icon name="info" :size="16" />
          <span>
            L'identifiant de connexion et le mot de passe sont generes automatiquement et affiches
            une seule fois a la creation.
          </span>
        </p>
        <p v-if="compteErreur" class="alert alert-danger">
          <Icon name="alert" :size="16" /><span>{{ compteErreur }}</span>
        </p>
      </form>

      <div v-else class="stack">
        <p>
          Compte cree pour <strong>{{ compteCree.personne }}</strong>. Notez ces identifiants et
          transmettez-les : <strong>ils ne seront plus jamais affiches</strong>.
        </p>

        <div class="identifiants">
          <div class="identifiant-ligne">
            <span class="small muted">Identifiant</span>
            <div class="row" style="gap: 8px">
              <code class="identifiant-valeur">{{ compteCree.nom_utilisateur }}</code>
              <button type="button" class="btn-sm btn-ghost" title="Copier" @click="copier(compteCree.nom_utilisateur, 'Identifiant')">
                <Icon name="copy" :size="15" />
              </button>
            </div>
          </div>
          <div class="identifiant-ligne">
            <span class="small muted">Mot de passe</span>
            <div class="row" style="gap: 8px">
              <code class="identifiant-valeur">{{ compteCree.mot_de_passe }}</code>
              <button type="button" class="btn-sm btn-ghost" title="Copier" @click="copier(compteCree.mot_de_passe, 'Mot de passe')">
                <Icon name="copy" :size="15" />
              </button>
            </div>
          </div>
        </div>

        <p class="alert alert-warning">
          <Icon name="warning" :size="16" />
          <span>
            Le mot de passe n'est enregistre que sous forme chiffree : il est irrecuperable une fois
            cette fenetre fermee. La personne pourra le changer elle-meme depuis Parametres.
          </span>
        </p>
      </div>

      <template #footer>
        <template v-if="!compteCree">
          <button type="button" @click="fermerCompte">Annuler</button>
          <button type="submit" form="form-compte" class="primary" :disabled="compteSoumission">
            <span v-if="compteSoumission" class="spinner" />
            Creer le compte
          </button>
        </template>
        <button v-else type="button" class="primary" @click="fermerCompte">J'ai note ces identifiants</button>
      </template>
    </Modal>

    <ConfirmDialog
      v-if="moduleADesactiver"
      :title="`Desactiver ${DESCRIPTION_MODULE[moduleADesactiver].titre} ?`"
      message="Toutes les pages, menus et donnees lies a ce module disparaitront immediatement de l'interface. Rien n'est supprime en base : tout reapparait tel quel si vous le reactivez."
      confirm-label="Desactiver"
      :busy="moduleEnCours === moduleADesactiver"
      @confirm="appliquerModule(moduleADesactiver, false)"
      @cancel="moduleADesactiver = null"
    />

    <ConfirmDialog
      v-if="aDesactiver"
      title="Desactiver ce compte ?"
      :message="`${aDesactiver.prenom} ${aDesactiver.nom} ne pourra plus se connecter, et ses sessions ouvertes seront fermees immediatement.`"
      confirm-label="Desactiver"
      :busy="desactivationEnCours"
      @confirm="confirmerDesactivation"
      @cancel="aDesactiver = null"
    />
    <ScannerDocument v-if="scannerVisible" @close="scannerVisible = false" />
  </div>
</template>

<style scoped>
.jauge {
  flex: 1;
  height: 5px;
  border-radius: var(--r-full);
  background: var(--bg-subtle);
  overflow: hidden;
}
.jauge-remplissage {
  height: 100%;
  border-radius: var(--r-full);
  transition: width 160ms ease;
}

.identifiants {
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  overflow: hidden;
}
.identifiant-ligne {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
}
.identifiant-ligne + .identifiant-ligne { border-top: 1px dashed var(--border); }
.identifiant-valeur {
  font-size: 17px;
  font-weight: 650;
  color: var(--text-h);
  letter-spacing: 0.02em;
}

/* Formulaire de l'etablissement : deux colonnes des qu'il y a la place, une
   seule sur telephone. `minmax(0, 1fr)` et non `1fr` — `1fr` vaut
   `minmax(auto, 1fr)`, dont la borne basse est la largeur du contenu, ce qui
   fait deborder la grille des qu'un champ contient un texte long. */
.grid-champs {
  display: grid;
  gap: 14px 16px;
  grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr));
}
/* Un champ marque "large" occupe toute la rangee : une adresse ou une mention
   legale se lit mal dans une demi-colonne. */
.champ-large { grid-column: 1 / -1; }

.champ-requis { color: var(--danger); margin-left: 2px; }
</style>

<style scoped>
/* Sous-option d'un module : en retrait et sur un fond plus discret, pour qu'on
   voie d'un coup d'oeil qu'elle depend de l'interrupteur au-dessus. */
.switch-sous {
  margin-left: 22px;
  border-left: 2px solid var(--border);
  background: var(--bg-subtle);
}

.switch-sous .switch-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.875rem;
}

@media (max-width: 700px) {
  .switch-sous { margin-left: 12px; }
}
</style>
