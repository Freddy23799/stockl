const pool = require('../config/db');

// Verifie que les invariants critiques du systeme tiennent toujours, apres
// des annees d'usage (bug latent, coupure de courant en plein milieu d'une
// transaction, intervention manuelle en base, etc.). Ne modifie rien - purement
// diagnostique. Code de sortie non-zero si un probleme est trouve (utilisable
// dans une tache planifiee qui alerte l'admin).
async function run() {
  let problemes = 0;

  // 1) Le stock physique de chaque produit doit toujours egaler la somme des
  //    quantites restantes dans ses lots (l'invariant FIFO, cf. stock.service.js).
  const { rows: ecartsLots } = await pool.query(`
    SELECT p.id, p.nom, p.quantite_stock,
           COALESCE(SUM(l.quantite_restante), 0) AS somme_lots
    FROM produits p
    LEFT JOIN lots_stock l ON l.produit_id = p.id
    GROUP BY p.id, p.nom, p.quantite_stock
    HAVING p.quantite_stock != COALESCE(SUM(l.quantite_restante), 0)
  `);
  if (ecartsLots.length > 0) {
    problemes += ecartsLots.length;
    console.error(`[ECART] ${ecartsLots.length} produit(s) ou stock != somme des lots :`);
    for (const e of ecartsLots) {
      console.error(`  - #${e.id} ${e.nom} : stock=${e.quantite_stock}, lots=${e.somme_lots}`);
    }
  }

  // 2) Le stock ne doit jamais etre negatif (regle stricte du brief).
  const { rows: stockNegatif } = await pool.query(
    `SELECT id, nom, quantite_stock FROM produits WHERE quantite_stock < 0`
  );
  if (stockNegatif.length > 0) {
    problemes += stockNegatif.length;
    console.error(`[ECART] ${stockNegatif.length} produit(s) avec un stock negatif :`);
    for (const p of stockNegatif) console.error(`  - #${p.id} ${p.nom} : ${p.quantite_stock}`);
  }

  // 3) Le montant total d'une vente doit toujours correspondre a la somme de ses lignes
  //    (prix_vente_snapshot x quantite) - jamais recalcule, mais doit rester coherent.
  const { rows: ecartsVentes } = await pool.query(`
    SELECT v.id, v.montant_total, COALESCE(SUM(vl.prix_vente_snapshot * vl.quantite), 0) AS somme_lignes
    FROM ventes v
    LEFT JOIN ventes_lignes vl ON vl.vente_id = v.id
    GROUP BY v.id, v.montant_total
    HAVING v.montant_total != COALESCE(SUM(vl.prix_vente_snapshot * vl.quantite), 0)
  `);
  if (ecartsVentes.length > 0) {
    problemes += ecartsVentes.length;
    console.error(`[ECART] ${ecartsVentes.length} vente(s) ou montant_total != somme des lignes :`);
    for (const v of ecartsVentes) {
      console.error(`  - vente #${v.id} : montant_total=${v.montant_total}, somme_lignes=${v.somme_lignes}`);
    }
  }

  // 4) Une vente attribuee doit toujours referencer une vendeuse existante.
  const { rows: ventesOrphelines } = await pool.query(`
    SELECT v.id FROM ventes v
    WHERE v.type = 'vendeuse' AND v.vendeuse_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM vendeuses vd WHERE vd.id = v.vendeuse_id)
  `);
  if (ventesOrphelines.length > 0) {
    problemes += ventesOrphelines.length;
    console.error(`[ECART] ${ventesOrphelines.length} vente(s) attribuee(s) a une vendeuse inexistante :`);
    for (const v of ventesOrphelines) console.error(`  - vente #${v.id}`);
  }

  if (problemes === 0) {
    console.log('Verification d\'integrite : OK, aucun ecart detecte.');
  } else {
    console.error(`\nVerification d'integrite : ${problemes} probleme(s) detecte(s).`);
  }

  await pool.end();
  process.exit(problemes === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Echec de la verification d\'integrite:', err.message);
  process.exit(2);
});
