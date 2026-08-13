import api from '../api/client'
import { useTelechargementsStore } from '../stores/telechargements'

// -----------------------------------------------------------------------------
// Telechargement d'un document depuis l'API.
//
// Le fichier ne peut pas etre ouvert par un simple lien : les endpoints sont
// proteges par un jeton porte dans un entete `Authorization`, qu'un `<a href>`
// ou un `window.open` n'envoie pas. On recupere donc le document en XHR, puis
// on declenche l'enregistrement a partir du blob obtenu.
//
// Effet de bord utile : c'est ce qui permet de suivre la progression et
// d'afficher un indicateur, ce qu'un lien direct ne permettrait pas.
// -----------------------------------------------------------------------------

// Le message d'erreur du serveur arrive en JSON, mais `responseType: 'blob'`
// s'applique aussi aux reponses d'erreur : sans cette relecture, on afficherait
// "[object Blob]" a la place de la raison du refus.
async function messageDErreur(erreur) {
  const donnees = erreur.response?.data
  if (donnees instanceof Blob) {
    try {
      const texte = await donnees.text()
      const json = JSON.parse(texte)
      if (json?.message) return json.message
    } catch {
      // Corps illisible ou non JSON : on retombe sur le message generique.
    }
  }
  if (donnees?.message) return donnees.message
  if (erreur.response?.status === 403) return "Vous n'avez pas acces a ce document"
  if (erreur.response?.status === 404) return 'Document introuvable'
  return erreur.message || 'Le telechargement a echoue'
}

// Declenche l'enregistrement du fichier.
//
// Le lien doit etre attache au document avant d'etre clique : Firefox ignore un
// clic sur un element detache. Sur iOS, le telechargement d'un blob n'est
// supporte qu'a partir de Safari 13 ; en dessous, l'ouverture dans un nouvel
// onglet est la seule issue et laisse l'utilisateur enregistrer a la main.
function enregistrerFichier(url, nomFichier) {
  const lien = document.createElement('a')
  const supporteTelechargement = 'download' in lien

  if (!supporteTelechargement) {
    window.open(url, '_blank')
    return
  }

  lien.href = url
  lien.download = nomFichier
  lien.rel = 'noopener'
  lien.style.display = 'none'
  document.body.appendChild(lien)
  lien.click()
  document.body.removeChild(lien)
}

/**
 * Telecharge un document PDF de l'API en suivant sa progression.
 *
 * @param {string} chemin      chemin relatif a l'API, ex. '/exports/ventes.pdf'
 * @param {object} options
 * @param {object} [options.params]      filtres, identiques a ceux de l'ecran
 * @param {string} options.libelle       nom lisible affiche dans l'indicateur
 * @param {string} options.nomFichier    nom propose a l'enregistrement
 * @param {'get'|'post'} [options.method] 'post' pour un endpoint qui GENERE le
 *   document (badge, attestation) au lieu de le lire : le corps de la requete
 *   porte alors les donnees de generation.
 * @param {object} [options.data]        corps envoye si method vaut 'post'
 * @returns {Promise<boolean>} vrai si le fichier a bien ete recu
 */
export async function telechargerDocument(chemin, { params = {}, libelle, nomFichier, method = 'get', data } = {}) {
  const telechargements = useTelechargementsStore()
  const controleur = new AbortController()
  const id = telechargements.ajouter({ libelle, nomFichier, controleur })

  try {
    const reponse = await api.request({
      url: chemin,
      method,
      data,
      params,
      responseType: 'blob',
      signal: controleur.signal,
      onDownloadProgress: (evenement) => {
        telechargements.progresser(id, {
          recus: evenement.loaded,
          // `total` reste indefini si la reponse n'annonce pas sa taille. Le
          // serveur envoie un `Content-Length` sur les PDF, mais un
          // intermediaire qui recompresse le flux peut le retirer.
          total: evenement.total,
        })
      },
    })

    const blob = reponse.data instanceof Blob
      ? reponse.data
      : new Blob([reponse.data], { type: 'application/pdf' })

    // Un corps vide signale une erreur silencieuse plutot qu'un document : mieux
    // vaut le dire que d'enregistrer un fichier de zero octet.
    if (blob.size === 0) {
      telechargements.echouer(id, 'Le document recu est vide')
      return false
    }

    const url = URL.createObjectURL(blob)
    telechargements.reussir(id, { url, taille: blob.size, nomFichier })
    enregistrerFichier(url, nomFichier)
    return true
  } catch (erreur) {
    // Une annulation demandee par l'utilisateur n'est pas un echec.
    if (controleur.signal.aborted) return false
    telechargements.echouer(id, await messageDErreur(erreur))
    return false
  }
}

// Nom de fichier daté, cote client, pour que l'enregistrement ne depende pas de
// la lecture d'un entete `Content-Disposition` (que le navigateur ne laisse pas
// toujours lire selon la configuration CORS).
export function nommerDocument(base) {
  const d = new Date()
  const deuxChiffres = (n) => String(n).padStart(2, '0')
  const jour = `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`
  return `${base}-${jour}.pdf`
}

export function formatTaille(octets) {
  if (!octets && octets !== 0) return ''
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} Ko`
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`
}
