const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { jwtSecret } = require('../config');
const { logAudit } = require('../db/audit');
const { genererNomUtilisateurUnique } = require('../utils/identifiant');
const { genererMotDePasse } = require('../utils/motdepasse');
const { genererCodeUnique } = require('../utils/codeVendeuse');

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

// Le code vendeuse remonte pour les comptes role='vendeuse' : c'est ce qui
// permet a l'admin de voir, au meme endroit, le login ET le code comptoir
// d'une meme personne.
async function list(req, res) {
  const { rows } = await pool.query(
    `SELECT u.id, u.prenom, u.nom, u.nom_utilisateur, u.email, u.role, u.actif, u.created_at,
            v.code AS vendeuse_code
     FROM utilisateurs u
     LEFT JOIN vendeuses v ON v.compte_utilisateur_id = u.id
     WHERE u.entreprise_id = $1
     ORDER BY u.nom, u.prenom`,
    [req.user.entrepriseId]
  );
  res.json(rows);
}

// Un compte est cree avec un role defini dans la matrice de son entreprise.
// Les roles personnalises deviennent donc attribuables sans liste codee en dur.
// Un compte 'vendeuse' doit
// obligatoirement etre rattache a un employe : c'est ce rattachement qui
// cree-ou-lie la fiche `vendeuses` (et son code a 6 chiffres) au compte de
// connexion, sans dupliquer la personne dans le systeme.
//
// L'administrateur ne saisit que le prenom et le nom (et l'employe, pour une
// vendeuse). L'identifiant de connexion et le mot de passe initial sont
// generes par le systeme et renvoyes UNE SEULE FOIS dans cette reponse : le
// mot de passe n'est stocke que sous forme de hash, il est donc
// definitivement irrecuperable ensuite.
async function create(req, res) {
  const { prenom, nom, email, role: roleDemande, employe_id: employeId } = req.body;
  if (!prenom || !String(prenom).trim() || !nom || !String(nom).trim()) {
    return res.status(400).json({ message: 'Le prenom et le nom sont requis' });
  }

  const role = String(roleDemande || 'admin').trim().toLowerCase();
  const { rows: rolesValides } = await pool.query(
    'SELECT code FROM roles WHERE entreprise_id = $1 AND code = $2',
    [req.user.entrepriseId, role]
  );
  if (!rolesValides.length) {
    return res.status(400).json({
      message: 'Role invalide ou non disponible dans cette entreprise.',
    });
  }
  if (role === 'vendeuse' && !employeId) {
    return res.status(400).json({
      message: 'Choisissez l\'employe a qui attribuer ce compte vendeuse',
      code: 'EMPLOYE_REQUIS',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let employe = null;
    let vendeuseExistante = null;
    if (role === 'vendeuse') {
      const { rows: employes } = await client.query(
        'SELECT id, prenom, nom, telephone, actif FROM employes WHERE id = $1 AND entreprise_id = $2',
        [employeId, req.user.entrepriseId]
      );
      employe = employes[0];
      if (!employe) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Employe introuvable' });
      }
      if (!employe.actif) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: 'Cet employe est archive : il ne peut pas recevoir de compte vendeuse.',
          code: 'EMPLOYE_ARCHIVE',
        });
      }

      const { rows: dejaRows } = await client.query(
        'SELECT id, code, actif, compte_utilisateur_id FROM vendeuses WHERE employe_id = $1',
        [employeId]
      );
      vendeuseExistante = dejaRows[0] || null;
      if (vendeuseExistante?.compte_utilisateur_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Cet employe a deja un compte vendeuse.',
          code: 'DEJA_COMPTE_VENDEUSE',
        });
      }
    }

    const nomUtilisateur = await genererNomUtilisateurUnique(client, prenom, nom, {
      entrepriseId: req.user.entrepriseId,
    });
    const motDePasseInitial = genererMotDePasse();
    const passwordHash = await bcrypt.hash(motDePasseInitial, 10);

    const { rows } = await client.query(
      `INSERT INTO utilisateurs (prenom, nom, nom_utilisateur, email, password_hash, role, entreprise_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, prenom, nom, nom_utilisateur, email, role, actif, created_at`,
      [String(prenom).trim(), String(nom).trim(), nomUtilisateur, email || null, passwordHash, role, req.user.entrepriseId]
    );
    const utilisateur = rows[0];

    // Cree-ou-lie la fiche vendeuse UNE FOIS le compte pose, pour disposer de
    // son id : une fiche deja existante (code deja distribue au comptoir)
    // recoit simplement son lien de connexion, sans perdre son code ni son
    // historique de ventes.
    let vendeuseCode = null;
    if (role === 'vendeuse') {
      if (vendeuseExistante) {
        const { rows: majRows } = await client.query(
          'UPDATE vendeuses SET compte_utilisateur_id = $1 WHERE id = $2 RETURNING code',
          [utilisateur.id, vendeuseExistante.id]
        );
        vendeuseCode = majRows[0].code;
      } else {
        const nomComplet = `${employe.prenom} ${employe.nom}`.trim();
        const code = await genererCodeUnique(client);
        await client.query(
          `INSERT INTO vendeuses (nom, contact, code, employe_id, compte_utilisateur_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [nomComplet, employe.telephone || null, code, employeId, utilisateur.id]
        );
        vendeuseCode = code;
      }
    }

    // Le mot de passe genere n'apparait jamais dans l'audit.
    await logAudit(client, {
      typeOperation: 'utilisateur_creation',
      entiteId: utilisateur.id,
      utilisateurId: req.user?.id,
      details: { ...libellesCompte(utilisateur), role, employe_id: role === 'vendeuse' ? employeId : null },
      apres: etatUtilisateurPourAudit(utilisateur),
    });

    await client.query('COMMIT');
    res.status(201).json({ ...utilisateur, mot_de_passe_initial: motDePasseInitial, vendeuse_code: vendeuseCode });
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

// Modification d'un compte par un administrateur.
//
// Sans cela, une erreur de saisie a la creation - un prenom mal orthographie,
// un nom de famille incomplet - etait definitive : il ne restait qu'a bloquer
// le compte et a en creer un autre, en perdant le lien entre les ecritures du
// journal et la personne.
//
// L'identifiant de connexion n'est PAS refait automatiquement quand le nom
// change : la personne s'en sert tous les jours et le connait par coeur. Il
// faut le demander explicitement (`regenerer_identifiant`), et l'interface
// affiche alors le nouveau pour qu'on puisse le lui transmettre.
async function modifier(req, res) {
  const { id } = req.params;
  const { prenom, nom, email, regenerer_identifiant } = req.body;

  if (!prenom || !String(prenom).trim() || !nom || !String(nom).trim()) {
    return res.status(400).json({ message: 'Le prenom et le nom sont requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existantsRows } = await client.query(
      `SELECT id, prenom, nom, nom_utilisateur, email, role, actif
         FROM utilisateurs WHERE id = $1 AND entreprise_id = $2 FOR UPDATE`,
      [id, req.user.entrepriseId]
    );
    if (existantsRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }
    const existant = existantsRows[0];

    const nomUtilisateur = regenerer_identifiant
      ? await genererNomUtilisateurUnique(client, prenom, nom, {
        exclureId: Number(id),
        entrepriseId: req.user.entrepriseId,
      })
      : existant.nom_utilisateur;

    // L'email n'est ecrit que si le corps le porte. Sans ce test, une requete
    // qui ne parle que du nom effacerait l'adresse au passage - un PATCH ne
    // doit pas toucher a ce qu'on ne lui a pas demande.
    const emailAEcrire = email === undefined ? existant.email : (email || null);

    const { rows } = await client.query(
      `UPDATE utilisateurs
          SET prenom = $1, nom = $2, email = $3, nom_utilisateur = $4
        WHERE id = $5
      RETURNING id, prenom, nom, nom_utilisateur, email, role, actif, created_at`,
      [String(prenom).trim(), String(nom).trim(), emailAEcrire, nomUtilisateur, id]
    );

    await logAudit(client, {
      typeOperation: 'utilisateur_modification',
      entiteId: Number(id),
      utilisateurId: req.user?.id,
      details: {
        ...libellesCompte(rows[0]),
        identifiant_regenere: nomUtilisateur !== existant.nom_utilisateur,
      },
      avant: etatUtilisateurPourAudit(existant),
      apres: etatUtilisateurPourAudit(rows[0]),
    });

    await client.query('COMMIT');
    res.json({
      ...rows[0],
      // Renvoye seulement quand il a change : c'est ce que l'interface montre
      // dans son encart "a transmettre".
      ancien_nom_utilisateur: nomUtilisateur !== existant.nom_utilisateur
        ? existant.nom_utilisateur
        : undefined,
    });
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

// Reinitialisation du mot de passe d'un AUTRE compte.
//
// Le seul recours quand quelqu'un a oublie le sien : il n'existe aucune
// procedure d'envoi par email, et le mot de passe n'est stocke qu'en hash, donc
// personne - pas meme l'administrateur - ne peut le relire. Sans cette action,
// un compte dont le mot de passe est perdu etait definitivement mort.
//
// Le nouveau mot de passe est genere par le systeme et renvoye UNE SEULE FOIS,
// comme a la creation. Toutes les sessions ouvertes de ce compte sont coupees :
// si quelqu'un s'en servait sans y avoir droit, la reinitialisation le met
// dehors immediatement.
async function reinitialiserMotDePasse(req, res) {
  const { id } = req.params;

  // Son propre mot de passe passe par l'ecran "Mon mot de passe", qui exige
  // l'ancien et renvoie un jeton neuf. Passer par ici se couperait la session
  // en cours pour un resultat moins bon.
  if (Number(id) === req.user?.id) {
    return res.status(409).json({
      message: 'Pour votre propre compte, utilisez « Mon mot de passe » : '
        + 'la session reste ouverte et vous choisissez vous-meme le nouveau.',
      code: 'AUTO_REINITIALISATION',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existantsRows } = await client.query(
      `SELECT id, prenom, nom, nom_utilisateur, email, role, actif
         FROM utilisateurs WHERE id = $1 AND entreprise_id = $2 FOR UPDATE`,
      [id, req.user.entrepriseId]
    );
    if (existantsRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }
    const existant = existantsRows[0];

    const motDePasse = genererMotDePasse();
    const passwordHash = await bcrypt.hash(motDePasse, 10);

    await client.query(
      `UPDATE utilisateurs
          SET password_hash = $1,
              tokens_invalides_avant = date_trunc('second', now())
        WHERE id = $2`,
      [passwordHash, id]
    );

    // Ni le mot de passe ni son empreinte n'entrent au journal : la ligne dit
    // qui a reinitialise quel compte, et rien de plus.
    await logAudit(client, {
      typeOperation: 'utilisateur_reinitialisation_mot_de_passe',
      entiteId: Number(id),
      utilisateurId: req.user?.id,
      details: { ...libellesCompte(existant), sessions_coupees: true },
    });

    await client.query('COMMIT');
    res.json({
      id: existant.id,
      prenom: existant.prenom,
      nom: existant.nom,
      nom_utilisateur: existant.nom_utilisateur,
      mot_de_passe_initial: motDePasse,
    });
  } catch (err) {
    await client.query('ROLLBACK');
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
      `SELECT id, prenom, nom, nom_utilisateur, email, role, entreprise_id, password_hash
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
    const token = jwt.sign(
      { id: utilisateur.id, role: utilisateur.role, entrepriseId: utilisateur.entreprise_id },
      jwtSecret,
      { expiresIn: '12h' }
    );

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
        entreprise_id: utilisateur.entreprise_id,
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
       WHERE role = 'admin' AND actif = true AND id <> $1 AND entreprise_id = $2`,
      [id, req.user.entrepriseId]
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
         FROM utilisateurs WHERE id = $1 AND entreprise_id = $2 FOR UPDATE`,
      [id, req.user.entrepriseId]
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
         FROM utilisateurs WHERE id = $1 AND entreprise_id = $2 FOR UPDATE`,
      [id, req.user.entrepriseId]
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

module.exports = {
  list, create, modifier, reinitialiserMotDePasse,
  changerMotDePasse, desactiver, reactiver,
};
