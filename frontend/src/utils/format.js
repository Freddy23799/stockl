export function formatMontant(valeur) {
  const n = Number(valeur || 0)
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' F'
}

export function formatQuantite(valeur) {
  const n = Number(valeur || 0)
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

export function formatDate(valeur) {
  if (!valeur) return ''
  return new Date(valeur).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function formatDateCourt(valeur) {
  if (!valeur) return ''
  return new Date(valeur).toLocaleDateString('fr-FR')
}
