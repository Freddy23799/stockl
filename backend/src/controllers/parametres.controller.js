const pool = require('../config/db');
const { logAudit } = require('../db/audit');
const { finaliserFichier, nettoyerAnciennesVersions } = require('../middleware/upload.middleware');

/* --- Champs modifiables --------------------------------------------------- */

// Specification des champs, source unique de verite : elle produit a la fois la
// validation, la requete SQL et le journal d'audit. Ajouter un champ a l'identite
// de l'etablissement ne demande donc qu'une ligne ici, plus la migration.
//
// `max` reprend la taille de la colonne. Sans cette borne, une saisie trop longue
// remonte en erreur PostgreSQL 22001 et l'utilisateur recoit un 500 opaque au
// lieu d'un message qui lui dit quoi corriger.
const CHAMPS_ETABLISSEMENT = [
  { colonne: 'etablissement_nom', libelle: "Nom de l'etablissement", max: 150, obligatoire: true },
  { colonne: 'etablissement_slogan', libelle: 'Slogan', max: 200 },
  { colonne: 'etablissement_activite', libelle: "Secteur d'activite", max: 150 },
  { colonne: 'etablissement_adresse', libelle: 'Adresse', max: 200 },
  { colonne: 'etablissement_quartier', libelle: 'Quartier', max: 120 },
  { colonne: 'etablissement_ville', libelle: 'Ville', max: 100 },
  { colonne: 'etablissement_pays', libelle: 'Pays', max: 100 },
  { colonne: 'etablissement_boite_postale', libelle: 'Boite postale', max: 60 },
  { colonne: 'etablissement_telephone', libelle: 'Telephone principal', max: 60, type: 'telephone' },
  { colonne: 'etablissement_telephone_2', libelle: 'Telephone secondaire', max: 60, type: 'telephone' },
  { colonne: 'etablissement_email', libelle: 'Adresse email', max: 150, type: 'email' },
  { colonne: 'etablissement_site_web', libelle: 'Site web', max: 200 },
  { colonne: 'etablissement_registre_commerce', libelle: 'Registre du commerce', max: 80 },
  { colonne: 'etablissement_identifiant_fiscal', libelle: 'Identifiant fiscal', max: 80 },
  { colonne: 'etablissement_capital', libelle: 'Capital social', max: 80 },
  { colonne: 'etablissement_mention_pied', libelle: 'Mention de bas de page', max: 300 },
  { colonne: 'devise', libelle: 'Devise', max: 10, obligatoire: true },
];

const CHAMPS_SYSTEME = [
  'methode_valorisation', 'logo_path',
  'module_ventes', 'module_fournisseurs', 'module_depenses',
  'module_employes', 'module_paie', 'module_badges',
];

// Volontairement permissif : les formats de numero varient trop d'un pays a
// l'autre pour qu'une regle stricte rende service. On ne refuse que ce qui ne
// peut pas etre un numero du tout.
const MOTIF_TELEPHONE = /^[0-9+().\s-]{4,}$/;
const MOTIF_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normaliser(valeur) {
  if (valeur === undefined) return undefined;
  if (valeur === null) return null;
  const texte = String(valeur).trim();
  // Un champ vide efface la valeur : sans cela, un numero saisi par erreur ne
  // pourrait plus jamais etre retire de l'entete des documents imprimes.
  return texte === '' ? null : texte;
}

function validerEtablissement(corps) {
  const erreurs = [];
  const valeurs = {};

  for (const champ of CHAMPS_ETABLISSEMENT) {
    const valeur = normaliser(corps[champ.colonne]);
    if (valeur === undefined) continue;

    if (champ.obligatoire && valeur === null) {
      erreurs.push(`${champ.libelle} ne peut pas etre vide.`);
      continue;
    }
    if (valeur !== null) {
      if (valeur.length > champ.max) {
        erreurs.push(`${champ.libelle} : ${champ.max} caracteres maximum.`);
        continue;
      }
      if (champ.type === 'email' && !MOTIF_EMAIL.test(valeur)) {
        erreurs.push(`${champ.libelle} : format d'adresse email invalide.`);
        continue;
      }
      if (champ.type === 'telephone' && !MOTIF_TELEPHONE.test(valeur)) {
        erreurs.push(`${champ.libelle} : ce numero ne semble pas valide.`);
        continue;
      }
    }
    valeurs[champ.colonne] = valeur;
  }

  return { erreurs, valeurs };
}

/* --- Lecture -------------------------------------------------------------- */

async function get(req, res) {
  const { rows } = await pool.query('SELECT * FROM parametres WHERE id = 1');
  res.json(rows[0]);
}

/* --- Ecriture ------------------------------------------------------------- */

async function update(req, res) {
  const { methode_valorisation } = req.body;
  if (methode_valorisation && !['FIFO', 'CMP'].includes(methode_valorisation)) {
    return res.status(400).json({ message: 'methode_valorisation doit etre FIFO ou CMP' });
  }

  const { erreurs, valeurs } = validerEtablissement(req.body);
  if (erreurs.length) {
    return res.status(400).json({ message: erreurs[0], erreurs, code: 'VALIDATION' });
  }

  // Seuls les champs presents dans le corps sont ecrits : la page Parametres
  // enregistre un onglet a la fois, elle ne doit pas effacer ce qu'elle
  // n'affiche pas.
  const aEcrire = { ...valeurs };
  for (const colonne of CHAMPS_SYSTEME) {
    if (req.body[colonne] !== undefined) aEcrire[colonne] = req.body[colonne];
  }

  const colonnes = Object.keys(aEcrire);
  if (colonnes.length === 0) {
    return res.status(400).json({ message: 'Aucun parametre a modifier' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Etat d'avant lu dans la meme transaction : c'est lui qui permet a
    // l'historique d'afficher "ancienne valeur -> nouvelle valeur".
    const { rows: avantRows } = await client.query('SELECT * FROM parametres WHERE id = 1');
    const avant = avantRows[0] || {};

    // Les noms de colonnes viennent de la liste figee ci-dessus, jamais du corps
    // de la requete : la construction dynamique est sans risque d'injection.
    const affectations = colonnes.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const { rows } = await client.query(
      `UPDATE parametres SET ${affectations} WHERE id = 1 RETURNING *`,
      colonnes.map((c) => aEcrire[c])
    );
    const apres = rows[0];

    // Seuls les champs reellement modifies entrent au journal. Sans ce filtre,
    // enregistrer le formulaire sans rien changer produirait une ligne d'audit
    // listant les dix-sept champs comme s'ils avaient tous bouge.
    const modifies = colonnes.filter((c) => String(avant[c] ?? '') !== String(apres[c] ?? ''));
    if (modifies.length) {
      const extraire = (source) => Object.fromEntries(modifies.map((c) => [c, source[c]]));
      const toucheEtablissement = modifies.some((c) => c.startsWith('etablissement_') || c === 'devise');
      await logAudit(client, {
        typeOperation: toucheEtablissement ? 'etablissement_modification' : 'parametres_modification',
        entiteId: 1,
        utilisateurId: req.user.id,
        details: { champs_modifies: modifies.join(', ') },
        avant: extraire(avant),
        apres: extraire(apres),
      });
    }

    await client.query('COMMIT');
    res.json(apres);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function uploadLogo(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier recu' });

  // Le fichier n'est renomme en "logo-machibel.<ext>" qu'ici, une fois l'envoi
  // recu en entier : un envoi interrompu ne detruit jamais le logo en place.
  const relativePath = finaliserFichier(req.file, 'logo', 'logo-machibel');
  nettoyerAnciennesVersions('logo', 'logo-machibel', relativePath);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: avantRows } = await client.query('SELECT logo_path FROM parametres WHERE id = 1');
    const { rows } = await client.query(
      'UPDATE parametres SET logo_path = $1 WHERE id = 1 RETURNING *',
      [relativePath]
    );
    await logAudit(client, {
      typeOperation: 'parametres_logo_modifie',
      entiteId: 1,
      utilisateurId: req.user.id,
      details: { logo_path: relativePath },
      avant: avantRows[0] || null,
      apres: { logo_path: relativePath },
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

module.exports = { get, update, uploadLogo, CHAMPS_ETABLISSEMENT };
