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

// Serie quotidienne (CA + depenses par jour) pour tracer une courbe de tendance.
// Ne fait aucun appel externe : tout est calcule a partir des donnees deja en base.
async function computeSerieQuotidienne({ from, to, vendeuseId }) {
  const { ventesActif, depensesActif } = await getModulesActifs();
  if (!from || !to) throw new Error('from et to sont requis');

  let parJourVentes = [];
  if (ventesActif) {
    const conditions = [`date >= $1`, `date <= $2`];
    const params = [from, to];
    if (vendeuseId) { params.push(vendeuseId); conditions.push(`vendeuse_id = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('day', date), 'YYYY-MM-DD') AS jour,
              COALESCE(SUM(montant_total), 0) AS chiffre_affaires,
              COUNT(*) AS nombre_ventes
       FROM ventes WHERE ${conditions.join(' AND ')}
       GROUP BY 1 ORDER BY 1`,
      params
    );
    parJourVentes = rows;
  }

  let parJourDepenses = [];
  if (depensesActif) {
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('day', date), 'YYYY-MM-DD') AS jour,
              COALESCE(SUM(montant), 0) AS depenses
       FROM depenses WHERE date >= $1 AND date <= $2
       GROUP BY 1 ORDER BY 1`,
      [from, to]
    );
    parJourDepenses = rows;
  }

  const parJour = new Map();
  for (const r of parJourVentes) {
    parJour.set(r.jour, { jour: r.jour, chiffre_affaires: Number(r.chiffre_affaires), nombre_ventes: Number(r.nombre_ventes), depenses: depensesActif ? 0 : null });
  }
  for (const r of parJourDepenses) {
    const existant = parJour.get(r.jour) || { jour: r.jour, chiffre_affaires: ventesActif ? 0 : null, nombre_ventes: ventesActif ? 0 : null, depenses: 0 };
    existant.depenses = Number(r.depenses);
    parJour.set(r.jour, existant);
  }

  return {
    modules_actifs: { ventes: ventesActif, depenses: depensesActif },
    serie: Array.from(parJour.values()).sort((a, b) => a.jour.localeCompare(b.jour)),
  };
}

// Detecte les produits qui se vendent le mieux / le moins bien sur une periode,
// avec leur tendance par rapport a la periode precedente de meme duree.
// Regles locales, deterministes, calculees a partir des donnees du systeme -
// aucun appel externe, aucun modele: juste un classement + une comparaison.
async function computePerformanceProduits({ from, to, limite = 5 }) {
  const { ventesActif } = await getModulesActifs();
  if (!ventesActif) return { actif: false, meilleures_ventes: [], faibles_ventes: [] };
  if (!from || !to) throw new Error('from et to sont requis');

  const dureeMs = new Date(to).getTime() - new Date(from).getTime();
  const fromPrecedent = new Date(new Date(from).getTime() - dureeMs).toISOString();
  const toPrecedent = from;

  async function ventesParProduit(debut, fin) {
    const { rows } = await pool.query(
      `SELECT p.id, p.nom, p.photo, COALESCE(SUM(vl.quantite), 0) AS quantite_vendue,
              COALESCE(SUM(vl.quantite * vl.prix_vente_snapshot), 0) AS montant
       FROM produits p
       LEFT JOIN ventes_lignes vl ON vl.produit_id = p.id
       LEFT JOIN ventes v ON v.id = vl.vente_id AND v.date >= $1 AND v.date <= $2
       WHERE p.actif = true
       GROUP BY p.id, p.nom, p.photo`,
      [debut, fin]
    );
    return new Map(rows.map((r) => [r.id, { ...r, quantite_vendue: Number(r.quantite_vendue), montant: Number(r.montant) }]));
  }

  const actuel = await ventesParProduit(from, to);
  const precedent = await ventesParProduit(fromPrecedent, toPrecedent);

  const classement = Array.from(actuel.values()).map((p) => {
    const avant = precedent.get(p.id);
    const quantiteAvant = avant ? avant.quantite_vendue : 0;
    let tendance = 'stable';
    let variationPourcentage = null;
    if (quantiteAvant > 0) {
      variationPourcentage = ((p.quantite_vendue - quantiteAvant) / quantiteAvant) * 100;
      if (variationPourcentage > 10) tendance = 'hausse';
      else if (variationPourcentage < -10) tendance = 'baisse';
    } else if (p.quantite_vendue > 0) {
      tendance = 'hausse';
    }
    return { ...p, quantite_vendue_periode_precedente: quantiteAvant, tendance, variation_pourcentage: variationPourcentage };
  });

  const vendus = classement.filter((p) => p.quantite_vendue > 0).sort((a, b) => b.quantite_vendue - a.quantite_vendue);
  const meilleuresVentes = vendus.slice(0, limite);

  // "Faibles ventes" = produits actifs peu ou pas vendus sur la periode (y compris zero),
  // pour repérer le surstock dormant - pas juste les derniers du classement des vendus.
  const faiblesVentes = classement
    .sort((a, b) => a.quantite_vendue - b.quantite_vendue)
    .slice(0, limite);

  return { actif: true, meilleures_ventes: meilleuresVentes, faibles_ventes: faiblesVentes };
}

module.exports = { computeResume, computeSerieQuotidienne, computePerformanceProduits };
