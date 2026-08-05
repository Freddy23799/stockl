const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { jwtSecret } = require('../config');
const { logAudit } = require('../db/audit');
const { genererNomUtilisateurUnique } = require('../utils/identifiant');
const { genererMotDePasse } = require('../utils/motdepasse');

// Champs d'un compte retenus pour le journal. Liste blanche explicite : la
// ligne `utilisateurs` porte aussi `password_hash`, qui ne doit sortir de la
// base sous aucun pretexte - meme un hash n'a rien a faire dans un ecran
// consultable et exportable. (logAudit filtre en second rideau, voir audit.js.)
const CHAMPS_AUDIT_UTILISATEUR = ['prenom', 'nom', 'nom_utilisateur', 'email', 'role', 'actif'];

function etatUtilisateurPourAudit(utilisateur) {
  if (!utilisateur) return null;
  const etat = {};
  for (const champ of CHAMPS_AUDIT_UTILISATEUR) etat[champ] = utilisateur[champ];
  return etat;
}

// Libelles figes au moment de l'ecriture : un compte peut etre renomme, la
// ligne d'audit doit rester comprehensible sans aller relire la fiche.
function libellesCompte(utilisateur) {
  return {
    utilisateur_nom: [utilisateur.prenom, utilisateur.nom].filter(Boolean).join(' ') || utilisateur.nom_utilisateur,
    nom_utilisateur: utilisateur.nom_utilisateur,
  };
}

async function list(req, res) {
  const { rows } = await pool.query(
    `SELECT id, prenom, nom, nom_utilisateur, email, role, actif, created_at
     FROM utilisateurs ORDER BY nom, prenom`
  );
  res.json(rows);
}

// Seuls des comptes Administrateur existent : les vendeuses ne sont pas des
// utilisateurs, seulement des fiches de reference identifiees par un code.
//
// L'administrateur ne saisit que le prenom et le nom. L'identifiant de connexion
// et le mot de passe initial sont generes par le systeme et renvoyes UNE SEULE
// FOIS dans cette reponse : le mot de passe n'est stocke que sous forme de hash,
// il est donc definitivement irrecuperable ensuite.
async function create(req, res) {
  const { prenom, nom, email } = req.body;
  if (!prenom || !String(prenom).trim() || !nom || !String(nom).trim()) {
    return res.status(400).json({ message: 'Le prenom et le nom sont requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const nomUtilisateur = await genererNomUtilisateurUnique(client, prenom, nom);
    const motDePasseInitial = genererMotDePasse();
    const passwordHash = await bcrypt.hash(motDePasseInitial, 10);

    const { rows } = await client.query(
      `INSERT INTO utilisateurs (prenom, nom, nom_utilisateur, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')
       RETURNING id, prenom, nom, nom_utilisateur, email, role, actif, created_at`,
      [String(prenom).trim(), String(nom).trim(), nomUtilisateur, email || null, passwordHash]
    );
    const utilisateur = rows[0];

    // Le mot de passe genere n'apparait jamais dans l'audit.
    await logAudit(client, {
      typeOperation: 'utilisateur_creation',
      entiteId: utilisateur.id,
      utilisateurId: req.user?.id,
      details: libellesCompte(utilisateur),
      apres: etatUtilisateurPourAudit(utilisateur),
    });

    await client.query('COMMIT');
    res.status(201).json({ ...utilisateur, mot_de_passe_initial: motDePasseInitial });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Cet identifiant ou cet email est deja utilise' });
    }
    throw err;
  } finally {
    client.release();
  }
}

const LONGUEUR_MOT_DE_PASSE_MIN = 8;

// Changement de son propre mot de passe. Indispensable : le premier compte est
// cree au demarrage avec un mot de passe statique connu (voir bootstrap-admin.js),
// il DOIT pouvoir etre change des la mise en service.
async function changerMotDePasse(req, res) {
  const { mot_de_passe_actuel, nouveau_mot_de_passe } = req.body;
  if (!mot_de_passe_actuel || !nouveau_mot_de_passe) {
    return res.status(400).json({ message: 'mot_de_passe_actuel et nouveau_mot_de_passe sont requis' });
  }
  if (String(nouveau_mot_de_passe).length < LONGUEUR_MOT_DE_PASSE_MIN) {
    return res.status(400).json({
      message: `Le nouveau mot de passe doit faire au moins ${LONGUEUR_MOT_DE_PASSE_MIN} caracteres`,
    });
  }
  if (mot_de_passe_actuel === nouveau_mot_de_passe) {
    return res.status(400).json({ message: 'Le nouveau mot de passe doit etre different de l\'actuel' });
  }

  const client = await pool.connect();
  try {
    const { rows: utilisateurRows } = await client.query(
      `SELECT id, prenom, nom, nom_utilisateur, email, role, password_hash
       FROM utilisateurs WHERE id = $1 AND actif = true`,
      [req.user.id]
    );
    if (utilisateurRows.length === 0) {
      return res.status(401).json({ message: 'Compte introuvable ou desactive' });
    }

    const match = await bcrypt.compare(mot_de_passe_actuel, utilisateurRows[0].password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Mot de passe actuel incorrect' });
    }

    const nouveauHash = await bcrypt.hash(nouveau_mot_de_passe, 10);

    await client.query('BEGIN');
    try {
      // Le seuil coupe toutes les sessions ouvertes ailleurs (autre poste, autre
      // navigateur). Tronque a la seconde : le jeton renvoye juste apres porte
      // le meme `iat` et reste valable, donc l'utilisateur courant n'est pas
      // deconnecte. Voir migration 006 et auth.middleware.js.
      await client.query(
        `UPDATE utilisateurs
            SET password_hash = $1,
                tokens_invalides_avant = date_trunc('second', now())
          WHERE id = $2`,
        [nouveauHash, req.user.id]
      );
      // Ni le mot de passe ni son empreinte ne sont journalises : la ligne ne
      // porte que l'identite du compte et le fait que les autres sessions ont
      // ete coupees. Il n'y a donc volontairement ni `avant` ni `apres` ici.
      await logAudit(client, {
        typeOperation: 'utilisateur_changement_mot_de_passe',
        entiteId: req.user.id,
        utilisateurId: req.user.id,
        details: { ...libellesCompte(utilisateurRows[0]), sessions_coupees: true },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    // Jeton neuf renvoye immediatement : la session continue sans repasser par
    // l'ecran de connexion. Le compteur d'expiration repart de zero.
    const utilisateur = utilisateurRows[0];
    const token = jwt.sign({ id: utilisateur.id, role: utilisateur.role }, jwtSecret, {
      expiresIn: '12h',
    });

    res.json({
      message: 'Mot de passe modifie',
      token,
      user: {
        id: utilisateur.id,
        prenom: utilisateur.prenom,
        nom: utilisateur.nom,
        nom_utilisateur: utilisateur.nom_utilisateur,
        email: utilisateur.email,
        role: utilisateur.role,
      },
    });
  } finally {
    client.release();
  }
}

async function desactiver(req, res) {
  const { id } = req.params;

  // Se bloquer soi-meme, c'est se deconnecter sans pouvoir revenir : la
  // reactivation demande un compte administrateur connecte. Ce cas est distinct
  // de celui du dernier admin ci-dessous - un admin parmi plusieurs peut tres
  // bien se bloquer lui-meme sans fermer le systeme, et se retrouver dehors.
  if (Number(id) === req.user?.id) {
    return res.status(409).json({
      message: 'Vous ne pouvez pas bloquer votre propre compte. '
        + 'Demandez a un autre administrateur de le faire.',
      code: 'AUTO_BLOCAGE',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Desactiver le dernier admin actif fermerait le systeme definitivement :
    // plus personne ne pourrait se connecter, et il n'existe aucune procedure
    // de reinitialisation de mot de passe.
    const { rows: restantsRows } = await client.query(
      `SELECT count(*)::int AS n FROM utilisateurs
       WHERE role = 'admin' AND actif = true AND id <> $1`,
      [id]
    );
    if (restantsRows[0].n === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Impossible de desactiver le dernier compte administrateur actif. '
          + 'Creez d\'abord un autre compte administrateur.',
        code: 'DERNIER_ADMIN',
      });
    }

    const { rows: existantsRows } = await client.query(
      `SELECT id, prenom, nom, nom_utilisateur, email, role, actif
         FROM utilisateurs WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (existantsRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }
    const existant = existantsRows[0];

    // Coupe aussi les sessions deja ouvertes : sans ce seuil, un compte
    // desactive resterait utilisable jusqu'a l'expiration de son jeton.
    const { rows } = await client.query(
      `UPDATE utilisateurs
          SET actif = false,
              tokens_invalides_avant = date_trunc('second', now())
        WHERE id = $1
      RETURNING id, prenom, nom, nom_utilisateur, email, role, actif`,
      [id]
    );
    await logAudit(client, {
      typeOperation: 'utilisateur_desactivation',
      entiteId: Number(id),
      utilisateurId: req.user?.id,
      details: { ...libellesCompte(existant), sessions_coupees: true },
      avant: etatUtilisateurPourAudit(existant),
      apres: etatUtilisateurPourAudit(rows[0]),
    });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function reactiver(req, res) {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existantsRows } = await client.query(
      `SELECT id, prenom, nom, nom_utilisateur, email, role, actif
         FROM utilisateurs WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (existantsRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }
    const existant = existantsRows[0];

    // DECISION : `tokens_invalides_avant` n'est PAS touche ici.
    //
    // Ce seuil a ete pose au blocage pour couper les sessions ouvertes (voir
    // migration 006). Le remettre a NULL ressusciterait les jetons emis avant le
    // blocage et encore dans leur fenetre de 12 h : la session qu'on venait de
    // fermer redeviendrait valide toute seule, sans nouvelle connexion. Le seuil
    // reste donc en place - il ne gene pas la reactivation, puisque tout jeton
    // obtenu apres est necessairement emis apres lui.
    const { rows } = await client.query(
      `UPDATE utilisateurs SET actif = true WHERE id = $1
       RETURNING id, prenom, nom, nom_utilisateur, email, role, actif`,
      [id]
    );
    await logAudit(client, {
      typeOperation: 'utilisateur_reactivation',
      entiteId: Number(id),
      utilisateurId: req.user?.id,
      details: libellesCompte(existant),
      avant: etatUtilisateurPourAudit(existant),
      apres: etatUtilisateurPourAudit(rows[0]),
    });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { list, create, changerMotDePasse, desactiver, reactiver };
