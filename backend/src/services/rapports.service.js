const pool = require('../config/db');

async function getModulesActifs() {
  const { rows } = await pool.query('SELECT module_ventes, module_depenses FROM parametres WHERE id = 1');
  return { ventesActif: rows[0].module_ventes, depensesActif: rows[0].module_depenses };
}

// Un module desactive n'apparait pas juste "vide a zero" dans le rapport : ses
// champs valent `null`, pour que le frontend distingue "rien vendu ce jour-la"
// (0, section affichee) de "module eteint" (null, section entierement retiree).
async function computeResume({ from, to, vendeuseId }) {
  const { ventesActif, depensesActif } = await getModulesActifs();

  let chiffreAffaires = null;
  let nombreVentes = null;
  let quantiteVendue = null;
  let coutMarchandisesVendues = null;
  let parVendeuseAvecTaux = null;
  let caTotal = 0;

  if (ventesActif) {
    const conditionsVentes = [];
    const paramsVentes = [];
    if (from) { paramsVentes.push(from); conditionsVentes.push(`date >= $${paramsVentes.length}`); }
    if (to) { paramsVentes.push(to); conditionsVentes.push(`date <= $${paramsVentes.length}`); }
    if (vendeuseId) { paramsVentes.push(vendeuseId); conditionsVentes.push(`vendeuse_id = $${paramsVentes.length}`); }
    const whereVentes = conditionsVentes.length ? `WHERE ${conditionsVentes.join(' AND ')}` : '';

    const { rows: totauxRows } = await pool.query(
      `SELECT
         COALESCE(SUM(montant_total) FILTER (WHERE type = 'directe'), 0) AS ca_direct,
         COALESCE(SUM(montant_total) FILTER (WHERE type = 'vendeuse'), 0) AS ca_vendeuses,
         COALESCE(SUM(montant_total), 0) AS ca_total,
         COUNT(*) AS nombre_ventes
       FROM ventes ${whereVentes}`,
      paramsVentes
    );
    const totaux = totauxRows[0];

    const { rows: quantitesRows } = await pool.query(
      `SELECT COALESCE(SUM(vl.quantite), 0) AS quantite_vendue,
              COALESCE(SUM(vl.quantite * vl.cout_acquisition_snapshot), 0) AS cout_marchandises_vendues
       FROM ventes_lignes vl JOIN ventes v ON v.id = vl.vente_id
       ${whereVentes}`,
      paramsVentes
    );
    const quantites = quantitesRows[0];

    const { rows: parVendeuse } = await pool.query(
      `SELECT vd.id AS vendeuse_id, vd.nom, COUNT(v.id) AS nombre_ventes, COALESCE(SUM(v.montant_total), 0) AS montant
       FROM ventes v JOIN vendeuses vd ON vd.id = v.vendeuse_id
       ${whereVentes ? whereVentes + " AND v.type = 'vendeuse'" : "WHERE v.type = 'vendeuse'"}
       GROUP BY vd.id, vd.nom ORDER BY montant DESC`,
      paramsVentes
    );
    const caVendeusesTotal = Number(totaux.ca_vendeuses);

    caTotal = Number(totaux.ca_total);
    chiffreAffaires = { direct: Number(totaux.ca_direct), vendeuses: caVendeusesTotal, total: caTotal };
    nombreVentes = Number(totaux.nombre_ventes);
    quantiteVendue = Number(quantites.quantite_vendue);
    coutMarchandisesVendues = Number(quantites.cout_marchandises_vendues);
    parVendeuseAvecTaux = parVendeuse.map((v) => ({
      ...v,
      taux_contribution: caVendeusesTotal > 0 ? Number(v.montant) / caVendeusesTotal : 0,
    }));
  }

  let depensesTotal = null;
  if (depensesActif) {
    const conditionsDepenses = [];
    const paramsDepenses = [];
    if (from) { paramsDepenses.push(from); conditionsDepenses.push(`date >= $${paramsDepenses.length}`); }
    if (to) { paramsDepenses.push(to); conditionsDepenses.push(`date <= $${paramsDepenses.length}`); }
    const whereDepenses = conditionsDepenses.length ? `WHERE ${conditionsDepenses.join(' AND ')}` : '';
    const { rows: depensesRows } = await pool.query(
      `SELECT COALESCE(SUM(montant), 0) AS total FROM depenses ${whereDepenses}`,
      paramsDepenses
    );
    depensesTotal = Number(depensesRows[0].total);
  }

  // Le bilan n'a de sens que si au moins une source financiere est suivie.
  const bilanNet = (ventesActif || depensesActif)
    ? caTotal - (depensesTotal || 0) - (coutMarchandisesVendues || 0)
    : null;

  return {
    periode: { from: from || null, to: to || null },
    modules_actifs: { ventes: ventesActif, depenses: depensesActif },
    chiffre_affaires: chiffreAffaires,
    nombre_ventes: nombreVentes,
    quantite_vendue: quantiteVendue,
    cout_marchandises_vendues: coutMarchandisesVendues,
    depenses_total: depensesTotal,
    bilan_net: bilanNet,
    par_vendeuse: parVendeuseAvecTaux,
  };
}

module.exports = { computeResume };
