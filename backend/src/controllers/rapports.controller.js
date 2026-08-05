const pool = require('../config/db');
const { computeResume, computeSerieQuotidienne, computePerformanceProduits } = require('../services/rapports.service');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}
function startOfYear() {
  const d = new Date();
  return new Date(d.getFullYear(), 0, 1).toISOString();
}

function parPeriode(fromFn) {
  return async (req, res) => {
    const resume = await computeResume({
      from: fromFn(),
      to: new Date().toISOString(),
      vendeuseId: req.query.vendeuse_id || undefined,
    });
    res.json(resume);
  };
}

async function personnalise(req, res) {
  const { from, to, vendeuse_id } = req.query;
  const resume = await computeResume({ from, to, vendeuseId: vendeuse_id });
  res.json(resume);
}

// Compte rendu concis pour une seule vendeuse (identifiee par son code ou son id) -
// utilise par l'administrateur pour verifier rapidement la performance d'une
// vendeuse en particulier, sans les chiffres business-wide (depenses, bilan net).
async function mini(req, res) {
  const { from, to, vendeuse_id, code } = req.query;
  if (!vendeuse_id && !code) {
    return res.status(400).json({ message: 'vendeuse_id ou code est requis' });
  }

  const { rows } = code
    ? await pool.query('SELECT id, nom FROM vendeuses WHERE code = $1', [code])
    : await pool.query('SELECT id, nom FROM vendeuses WHERE id = $1', [vendeuse_id]);
  if (rows.length === 0) return res.status(404).json({ message: 'Vendeuse introuvable' });

  const resume = await computeResume({ from, to, vendeuseId: rows[0].id });

  res.json({
    vendeuse: rows[0],
    periode: resume.periode,
    montant_vendu: resume.chiffre_affaires.vendeuses,
    nombre_ventes: resume.nombre_ventes,
    quantite_vendue: resume.quantite_vendue,
  });
}

// Tableau de bord : activite la plus recente, pour un affichage instantane
// sans devoir choisir une periode au prealable. Les sections des modules
// desactives valent `null` (pas un tableau vide) pour que le frontend les
// retire entierement plutot que d'afficher une table sans lignes.
async function activiteRecente(req, res) {
  const limite = Math.min(Number(req.query.limite) || 10, 50);

  const { rows: paramRows } = await pool.query(
    'SELECT module_ventes, module_fournisseurs, module_depenses FROM parametres WHERE id = 1'
  );
  const { module_ventes: ventesActif, module_fournisseurs: fournisseursActif, module_depenses: depensesActif } = paramRows[0];

  const [ventes, mouvements, depenses] = await Promise.all([
    ventesActif
      ? pool.query(
          `SELECT v.id, v.type, v.montant_total, v.date, vd.nom AS vendeuse_nom
           FROM ventes v LEFT JOIN vendeuses vd ON vd.id = v.vendeuse_id
           ORDER BY v.date DESC LIMIT $1`,
          [limite]
        )
      : null,
    pool.query(
      `SELECT m.id, m.type, m.quantite, m.cout_unitaire, m.date, p.nom AS produit_nom${fournisseursActif ? ', f.nom AS fournisseur_nom' : ', NULL AS fournisseur_nom'}
       FROM mouvements_stock m
       JOIN produits p ON p.id = m.produit_id
       LEFT JOIN fournisseurs f ON f.id = m.fournisseur_id
       ORDER BY m.date DESC LIMIT $1`,
      [limite]
    ),
    depensesActif
      ? pool.query(`SELECT id, categorie, montant, note, date FROM depenses ORDER BY date DESC LIMIT $1`, [limite])
      : null,
  ]);

  res.json({
    modules_actifs: { ventes: ventesActif, fournisseurs: fournisseursActif, depenses: depensesActif },
    dernieres_ventes: ventes ? ventes.rows : null,
    derniers_mouvements_stock: mouvements.rows,
    dernieres_depenses: depenses ? depenses.rows : null,
  });
}

// Serie quotidienne (CA + depenses par jour) pour tracer une courbe de tendance
// sur la periode selectionnee - calcule uniquement a partir des donnees en base.
async function serie(req, res) {
  const { from, to, vendeuse_id } = req.query;
  if (!from || !to) return res.status(400).json({ message: 'from et to sont requis' });
  const resultat = await computeSerieQuotidienne({ from, to, vendeuseId: vendeuse_id });
  res.json(resultat);
}

// Produits les plus/moins vendus sur la periode, avec tendance vs periode
// precedente de meme duree. Regles locales deterministes (classement +
// comparaison), aucune IA/appel externe - conforme au fonctionnement hors-ligne.
async function performanceProduits(req, res) {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ message: 'from et to sont requis' });
  const limite = Math.min(Number(req.query.limite) || 5, 20);
  const resultat = await computePerformanceProduits({ from, to, limite });
  res.json(resultat);
}

// Comparaison rapide aujourd'hui vs hier, pour le tableau de bord.
async function comparaisonVeille(req, res) {
  const debutAujourdhui = startOfToday();
  const debutHier = new Date(debutAujourdhui);
  debutHier.setDate(debutHier.getDate() - 1);

  const [aujourdhui, hier] = await Promise.all([
    computeResume({ from: debutAujourdhui, to: new Date().toISOString() }),
    computeResume({ from: debutHier.toISOString(), to: debutAujourdhui }),
  ]);

  const caAuj = aujourdhui.chiffre_affaires?.total ?? null;
  const caHier = hier.chiffre_affaires?.total ?? null;
  let variationCaPourcentage = null;
  if (caAuj !== null && caHier) {
    variationCaPourcentage = ((caAuj - caHier) / caHier) * 100;
  }

  res.json({ aujourdhui, hier, variation_ca_pourcentage: variationCaPourcentage });
}

module.exports = {
  personnalise,
  mini,
  activiteRecente,
  serie,
  performanceProduits,
  comparaisonVeille,
  journalier: parPeriode(startOfToday),
  hebdomadaire: parPeriode(() => daysAgo(7)),
  mensuel: parPeriode(startOfMonth),
  annuel: parPeriode(startOfYear),
};
