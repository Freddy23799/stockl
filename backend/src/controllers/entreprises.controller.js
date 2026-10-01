const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { logAudit } = require('../db/audit');
const { normaliser, genererNomUtilisateurUnique } = require('../utils/identifiant');
const { genererMotDePasse } = require('../utils/motdepasse');

// Gestion des entreprises clientes, reservee a l'operateur de la plateforme
// (voir requireOperateurPlateforme). Volontairement minimal pour l'instant :
// creer une entreprise pose sa ligne, son premier compte admin et une ligne
// de parametres a elle - mais ses ecrans metier (produits, ventes, stock...)
// ne filtrent pas encore par entreprise partout. Tant que ce travail n'est
// pas termine, `auth.controller.js` refuse la connexion a toute entreprise
// autre que MACHIBEL (voir ENTREPRISE_ISOLATION_EFFECTIVE) : la creation reste
// donc sans danger (aucune donnee n'est encore melangee), mais l'entreprise
// creee n'est pas encore utilisable de bout en bout.

async function genererSlugUnique(client, nom, { exclureId = null } = {}) {
  const base = normaliser(nom);
  if (!base) throw new Error('Nom d\'entreprise invalide pour generer un identifiant');

  for (let suffixe = 1; suffixe <= 100; suffixe += 1) {
    const candidat = suffixe === 1 ? base : `${base}-${suffixe}`;
    const { rows } = await client.query(
      'SELECT 1 FROM entreprises WHERE lower(slug) = $1 AND ($2::int IS NULL OR id <> $2)',
      [candidat, exclureId]
    );
    if (rows.length === 0) return candidat;
  }
  throw new Error(`Impossible de generer un identifiant unique pour "${base}"`);
}

async function list(req, res) {
  const { rows } = await pool.query(
    `SELECT e.id, e.nom, e.slug, e.actif, e.bloquee_le, e.bloquee_par_id, e.motif_blocage, e.created_at,
            (SELECT count(*)::int FROM utilisateurs u WHERE u.entreprise_id = e.id) AS nombre_comptes
       FROM entreprises e
      ORDER BY e.created_at DESC`
  );
  res.json(rows);
}

// Cree une entreprise cliente et son premier compte administrateur, sur le
// meme modele que la creation d'un compte (identifiant et mot de passe
// generes, renvoyes UNE SEULE FOIS - voir utilisateurs.controller.js).
async function create(req, res) {
  const { nom, admin_prenom: adminPrenom, admin_nom: adminNom } = req.body;
  if (!nom || !String(nom).trim()) {
    return res.status(400).json({ message: 'Le nom de l\'entreprise est requis' });
  }
  if (!adminPrenom || !String(adminPrenom).trim() || !adminNom || !String(adminNom).trim()) {
    return res.status(400).json({
      message: 'Le prenom et le nom du premier administrateur de cette entreprise sont requis',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const slug = await genererSlugUnique(client, nom);

    const { rows: entrepriseRows } = await client.query(
      `INSERT INTO entreprises (nom, slug) VALUES ($1, $2)
       RETURNING id, nom, slug, actif, created_at`,
      [String(nom).trim(), slug]
    );
    const entreprise = entrepriseRows[0];

    // Ligne de parametres propre a cette entreprise, posee des la creation :
    // sans elle, le premier ecran qui la lira (une fois le filtrage par
    // entreprise termine sur ce controleur) tomberait sur une base vide.
    // `id` reste la cle technique historique de la table (voir migration 001,
    // avant l'introduction du multi-entreprise) : reprendre l'id de
    // l'entreprise garantit son unicite sans lui donner de sens propre.
    await client.query(
      'INSERT INTO parametres (id, entreprise_id) VALUES ($1, $2)',
      [entreprise.id, entreprise.id]
    );

    const nomUtilisateur = await genererNomUtilisateurUnique(client, adminPrenom, adminNom, {
      entrepriseId: entreprise.id,
    });
    const motDePasseInitial = genererMotDePasse();
    const passwordHash = await bcrypt.hash(motDePasseInitial, 10);

    const { rows: adminRows } = await client.query(
      `INSERT INTO utilisateurs (prenom, nom, nom_utilisateur, password_hash, role, entreprise_id)
       VALUES ($1, $2, $3, $4, 'admin', $5)
       RETURNING id, prenom, nom, nom_utilisateur, role`,
      [String(adminPrenom).trim(), String(adminNom).trim(), nomUtilisateur, passwordHash, entreprise.id]
    );
    const admin = adminRows[0];

    await logAudit(client, {
      typeOperation: 'entreprise_creation',
      entiteId: entreprise.id,
      utilisateurId: req.user.id,
      entrepriseId: entreprise.id,
      details: { nom: entreprise.nom, slug: entreprise.slug, admin_nom_utilisateur: admin.nom_utilisateur },
    });

    await client.query('COMMIT');
    res.status(201).json({
      entreprise,
      admin: { ...admin, mot_de_passe_initial: motDePasseInitial },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Une entreprise ou un compte avec cet identifiant existe deja' });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function bloquer(req, res) {
  const { id } = req.params;
  const motif = String(req.body?.motif || '').trim();
  if (!motif) return res.status(400).json({ message: 'Un motif de blocage est obligatoire.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE entreprises SET actif = false, bloquee_le = now(), bloquee_par_id = $1, motif_blocage = $2
       WHERE id = $3 AND actif = true RETURNING id, nom, slug, actif, bloquee_le, bloquee_par_id, motif_blocage`,
      [req.user.id, motif, id]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Entreprise introuvable ou deja bloquee.' }); }
    await client.query('UPDATE utilisateurs SET tokens_invalides_avant = now() WHERE entreprise_id = $1', [id]);
    await logAudit(client, { typeOperation: 'entreprise_blocage', entiteId: Number(id), utilisateurId: req.user.id, entrepriseId: Number(id), details: { nom: rows[0].nom, motif } });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

async function reactiver(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE entreprises SET actif = true, bloquee_le = NULL, bloquee_par_id = NULL, motif_blocage = NULL
     WHERE id = $1 AND actif = false RETURNING id, nom, slug, actif, bloquee_le, bloquee_par_id, motif_blocage`,
    [id]
  );
  if (rows.length === 0) return res.status(404).json({ message: 'Entreprise introuvable' });

  await logAudit(pool, {
    typeOperation: 'entreprise_deblocage',
    entiteId: Number(id),
    utilisateurId: req.user.id,
    entrepriseId: Number(id),
    details: { nom: rows[0].nom },
  });
  res.json(rows[0]);
}

module.exports = { list, create, bloquer, desactiver: bloquer, reactiver };
