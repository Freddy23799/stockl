const pool = require('../config/db');
const { getPagination } = require('../utils/pagination');
const {
  creerCycle, ajusterLigne, enregistrerVersement, totauxCycle,
  CycleClotureError, MontantVersementError,
} = require('../services/paie.service');

/* --- Onglet 1 : cycles de paie -------------------------------------------- */

async function listerCycles(req, res) {
  const { page, pageSize, offset } = getPagination(req);

  const { rows: countRows } = await pool.query('SELECT count(*)::int AS total FROM paie_cycles');

  // Les totaux sont agreges dans la meme requete : demander les compteurs cycle
  // par cycle produirait une requete par ligne affichee.
  const { rows } = await pool.query(
    `SELECT c.*,
            COALESCE(t.effectif, 0) AS effectif,
            COALESCE(t.total_a_payer, 0) AS total_a_payer,
            COALESCE(t.total_paye, 0) AS total_paye,
            COALESCE(t.reste_a_payer, 0) AS reste_a_payer,
            COALESCE(t.nombre_payes, 0) AS nombre_payes
       FROM paie_cycles c
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS effectif,
                SUM(net_a_payer) AS total_a_payer,
                SUM(montant_paye) AS total_paye,
                SUM(net_a_payer - montant_paye) AS reste_a_payer,
                count(*) FILTER (WHERE statut = 'paye')::int AS nombre_payes
           FROM paie_lignes l WHERE l.cycle_id = c.id
       ) t ON true
      ORDER BY c.periode_fin DESC, c.id DESC
      LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );

  res.json({ data: rows, total: countRows[0].total, page, pageSize });
}

async function obtenirCycle(req, res) {
  const { rows: cycles } = await pool.query(
    `SELECT c.*, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.prenom, u.nom)), ''), u.nom_utilisateur) AS auteur_nom
       FROM paie_cycles c LEFT JOIN utilisateurs u ON u.id = c.auteur_id
      WHERE c.id = $1`,
    [req.params.id]
  );
  const cycle = cycles[0];
  if (!cycle) return res.status(404).json({ message: 'Cycle de paie introuvable' });

  const { rows: lignes } = await pool.query(
    `SELECT l.*, e.photo, e.telephone,
            COALESCE(json_agg(json_build_object(
              'id', v.id, 'numero_recu', v.numero_recu, 'montant', v.montant,
              'mode_paiement', v.mode_paiement, 'est_solde', v.est_solde, 'paye_le', v.paye_le
            ) ORDER BY v.paye_le) FILTER (WHERE v.id IS NOT NULL), '[]') AS versements
       FROM paie_lignes l
       JOIN employes e ON e.id = l.employe_id
       LEFT JOIN paie_versements v ON v.ligne_id = l.id
      WHERE l.cycle_id = $1
      GROUP BY l.id, e.photo, e.telephone
      ORDER BY l.nom_complet_snapshot`,
    [req.params.id]
  );

  const client = await pool.connect();
  try {
    const totaux = await totauxCycle(client, cycle.id);
    res.json({ ...cycle, totaux, lignes });
  } finally {
    client.release();
  }
}

async function creer(req, res) {
  const {
    libelle, periode_debut, periode_fin,
    ajustement_sens, ajustement_mode, ajustement_valeur, ajustement_motif,
  } = req.body;

  if (!periode_debut || !periode_fin) {
    return res.status(400).json({ message: 'La date de debut et la date de fin sont requises' });
  }
  if (periode_fin < periode_debut) {
    return res.status(400).json({ message: 'La date de fin doit suivre la date de debut' });
  }
  if (ajustement_sens && !['augmentation', 'diminution'].includes(ajustement_sens)) {
    return res.status(400).json({ message: "L'ajustement doit etre une augmentation ou une diminution" });
  }
  if (ajustement_sens && !ajustement_valeur) {
    return res.status(400).json({ message: "Indiquez la valeur de l'ajustement general" });
  }
  if (ajustement_mode === 'pourcentage' && Number(ajustement_valeur) > 100
    && ajustement_sens === 'diminution') {
    return res.status(400).json({ message: 'Une retenue ne peut pas depasser 100 % du salaire' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { cycle, lignes } = await creerCycle(client, {
      libelle,
      periodeDebut: periode_debut,
      periodeFin: periode_fin,
      ajustementSens: ajustement_sens,
      ajustementMode: ajustement_mode,
      ajustementValeur: ajustement_valeur,
      ajustementMotif: ajustement_motif,
      auteurId: req.user.id,
    });

    if (lignes.length === 0) {
      // Un cycle vide n'a aucun sens et pieger l'utilisateur avec une fiche
      // sans employe serait pire que de refuser tout de suite.
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: "Aucun employe actif n'a de salaire defini couvrant cette periode. "
          + 'Verifiez les fiches employes avant de creer le cycle.',
        code: 'AUCUN_EMPLOYE',
      });
    }

    await client.query('COMMIT');
    res.status(201).json({ ...cycle, effectif: lignes.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function cloturer(req, res) {
  const { rows } = await pool.query(
    "UPDATE paie_cycles SET statut = 'cloture' WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Cycle introuvable' });
  res.json(rows[0]);
}

/* --- Ajustements et versements -------------------------------------------- */

async function ajuster(req, res) {
  const { montant, motif } = req.body;
  if (montant === undefined || !Number.isFinite(Number(montant))) {
    return res.status(400).json({ message: "Le montant de l'ajustement est requis" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ligne = await ajusterLigne(client, {
      ligneId: Number(req.params.ligneId),
      montant: Number(montant),
      motif,
      auteurId: req.user.id,
    });
    if (!ligne) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Ligne de paie introuvable' });
    }
    await client.query('COMMIT');
    res.json(ligne);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof CycleClotureError || err instanceof MontantVersementError) {
      return res.status(409).json({ message: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function payer(req, res) {
  const { montant, mode_paiement, note } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultat = await enregistrerVersement(client, {
      ligneId: Number(req.params.ligneId),
      montant,
      modePaiement: mode_paiement,
      note,
      auteurId: req.user.id,
    });
    if (!resultat) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Ligne de paie introuvable' });
    }
    await client.query('COMMIT');
    res.status(201).json(resultat.versement);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof CycleClotureError || err instanceof MontantVersementError) {
      return res.status(409).json({ message: err.message, code: err.code });
    }
    throw err;
  } finally {
    client.release();
  }
}

/* --- Onglet 2 : historique des recus -------------------------------------- */

async function listerRecus(req, res) {
  const { recherche, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (recherche) {
    params.push(`%${String(recherche).trim()}%`);
    // Un recu se retrouve par son numero, par le matricule, ou par le nom :
    // ce sont les trois seules choses dont on dispose quand quelqu'un se
    // presente avec un bout de papier a la main.
    conditions.push(
      `(v.numero_recu ILIKE $${params.length}
        OR l.matricule_snapshot ILIKE $${params.length}
        OR l.nom_complet_snapshot ILIKE $${params.length}
        OR c.reference ILIKE $${params.length})`
    );
  }
  if (from) { params.push(from); conditions.push(`v.paye_le >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`v.paye_le <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { page, pageSize, offset } = getPagination(req);

  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS total
       FROM paie_versements v
       JOIN paie_lignes l ON l.id = v.ligne_id
       JOIN paie_cycles c ON c.id = l.cycle_id ${where}`,
    params
  );

  const { rows } = await pool.query(
    `SELECT v.*, l.matricule_snapshot, l.nom_complet_snapshot, l.fonction_snapshot,
            l.net_a_payer, l.montant_paye, l.employe_id,
            c.id AS cycle_id, c.reference AS cycle_reference, c.libelle AS cycle_libelle,
            c.periode_debut, c.periode_fin,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.prenom, u.nom)), ''), u.nom_utilisateur) AS auteur_nom
       FROM paie_versements v
       JOIN paie_lignes l ON l.id = v.ligne_id
       JOIN paie_cycles c ON c.id = l.cycle_id
       LEFT JOIN utilisateurs u ON u.id = v.auteur_id
       ${where}
      ORDER BY v.paye_le DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );

  res.json({ data: rows, total: countRows[0].total, page, pageSize });
}

/* --- Onglet 3 : statistiques ---------------------------------------------- */

async function statistiques(req, res) {
  const { from, to, employe_id } = req.query;

  const conditions = [];
  const params = [];
  if (from) { params.push(from); conditions.push(`v.paye_le >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`v.paye_le <= $${params.length}`); }
  if (employe_id) { params.push(employe_id); conditions.push(`l.employe_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [global, parMois, parEmploye] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(v.montant), 0) AS total_verse,
              count(*)::int AS nombre_versements,
              count(DISTINCT l.employe_id)::int AS employes_payes,
              count(DISTINCT l.cycle_id)::int AS cycles_concernes
         FROM paie_versements v JOIN paie_lignes l ON l.id = v.ligne_id ${where}`,
      params
    ),
    pool.query(
      `SELECT to_char(date_trunc('month', v.paye_le), 'YYYY-MM') AS mois,
              COALESCE(SUM(v.montant), 0) AS montant,
              count(*)::int AS versements
         FROM paie_versements v JOIN paie_lignes l ON l.id = v.ligne_id ${where}
        GROUP BY 1 ORDER BY 1`,
      params
    ),
    pool.query(
      `SELECT l.employe_id, l.matricule_snapshot AS matricule,
              max(l.nom_complet_snapshot) AS nom_complet,
              max(l.fonction_snapshot) AS fonction,
              COALESCE(SUM(v.montant), 0) AS total_verse,
              count(*)::int AS versements,
              max(v.paye_le) AS dernier_paiement
         FROM paie_versements v JOIN paie_lignes l ON l.id = v.ligne_id ${where}
        GROUP BY l.employe_id, l.matricule_snapshot
        ORDER BY total_verse DESC`,
      params
    ),
  ]);

  // Reste du sur les cycles encore ouverts : c'est l'engagement en cours, la
  // question qu'on se pose vraiment avant de decaisser.
  const { rows: engagement } = await pool.query(
    `SELECT COALESCE(SUM(l.net_a_payer - l.montant_paye), 0) AS reste_a_payer,
            count(*) FILTER (WHERE l.statut <> 'paye')::int AS lignes_en_attente
       FROM paie_lignes l JOIN paie_cycles c ON c.id = l.cycle_id
      WHERE c.statut = 'ouvert'`
  );

  res.json({
    periode: { from: from || null, to: to || null },
    global: global.rows[0],
    engagement: engagement[0],
    par_mois: parMois.rows,
    par_employe: parEmploye.rows,
  });
}

/** Toutes les lignes de paie d'un employe, pour sa fiche et ses statistiques. */
async function historiqueEmploye(req, res) {
  const { rows } = await pool.query(
    `SELECT l.*, c.reference AS cycle_reference, c.libelle AS cycle_libelle,
            c.periode_debut, c.periode_fin, c.statut AS cycle_statut,
            COALESCE(json_agg(json_build_object(
              'id', v.id, 'numero_recu', v.numero_recu, 'montant', v.montant,
              'est_solde', v.est_solde, 'paye_le', v.paye_le
            ) ORDER BY v.paye_le) FILTER (WHERE v.id IS NOT NULL), '[]') AS versements
       FROM paie_lignes l
       JOIN paie_cycles c ON c.id = l.cycle_id
       LEFT JOIN paie_versements v ON v.ligne_id = l.id
      WHERE l.employe_id = $1
      GROUP BY l.id, c.reference, c.libelle, c.periode_debut, c.periode_fin, c.statut
      ORDER BY c.periode_fin DESC`,
    [req.params.id]
  );

  const total = rows.reduce((s, l) => s + Number(l.montant_paye), 0);
  res.json({ lignes: rows, masse_salariale_versee: total });
}

module.exports = {
  listerCycles, obtenirCycle, creer, cloturer,
  ajuster, payer,
  listerRecus, statistiques, historiqueEmploye,
};
