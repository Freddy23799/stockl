const pool = require('../config/db');
const { logAudit } = require('../db/audit');

function number(value) { return Number(Number(value).toFixed(2)); }
async function numero(client, table, prefix, entrepriseId) {
  const { rows } = await client.query(`SELECT COUNT(*)::int + 1 AS n FROM ${table} WHERE entreprise_id = $1`, [entrepriseId]);
  return `${prefix}-${new Date().getFullYear()}-${String(rows[0].n).padStart(5, '0')}`;
}
async function lignesValides(client, lignes, entrepriseId) {
  if (!Array.isArray(lignes) || !lignes.length) throw Object.assign(new Error('Au moins une ligne est requise.'), { status: 400 });
  const resultat = [];
  for (const ligne of lignes) {
    if (!Number.isInteger(Number(ligne.produit_id)) || Number(ligne.quantite) <= 0) throw Object.assign(new Error('Chaque ligne doit avoir un produit et une quantite positive.'), { status: 400 });
    const { rows } = await client.query('SELECT id, nom, prix_vente FROM produits WHERE id = $1 AND entreprise_id = $2 AND actif', [ligne.produit_id, entrepriseId]);
    if (!rows.length) throw Object.assign(new Error('Un produit est introuvable ou inactif.'), { status: 400 });
    const produit = rows[0]; const prix = ligne.prix_unitaire === undefined ? Number(produit.prix_vente) : Number(ligne.prix_unitaire); const remise = Number(ligne.remise_pourcentage || 0);
    if (prix < 0 || remise < 0 || remise > 100) throw Object.assign(new Error('Prix ou remise invalide.'), { status: 400 });
    resultat.push({ produit_id: produit.id, description: ligne.description?.trim() || produit.nom, quantite: Number(ligne.quantite), prix_unitaire: prix, remise_pourcentage: remise, total_ligne: number(Number(ligne.quantite) * prix * (1 - remise / 100)) });
  }
  return resultat;
}
// Equipe, departement et agence ne sont pas encore modelises dans cette base.
// En attendant leurs tables de rattachement, ils se degradent vers `own` :
// ouvrir toutes les donnees serait une fuite, pas un confort provisoire.
function scope(condition, params, req, field) {
  if (!['company', 'global'].includes(req.permission.perimetre)) {
    params.push(req.user.id); condition.push(`${field} = $${params.length}`);
  }
}
async function list(req, res) {
  const params = [req.user.entrepriseId], where = ['d.entreprise_id = $1']; scope(where, params, req, 'd.commercial_id');
  const { rows } = await pool.query(`SELECT d.*, c.nom AS client_nom, concat_ws(' ', u.prenom, u.nom) AS commercial_nom FROM devis d JOIN clients c ON c.id=d.client_id JOIN utilisateurs u ON u.id=d.commercial_id WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT 300`, params);
  res.json(rows.map((d) => ({ ...d, montant_total: Number(d.montant_total) })));
}
async function getById(req, res) {
  const params = [req.params.id, req.user.entrepriseId], where = ['d.id=$1', 'd.entreprise_id=$2']; scope(where, params, req, 'd.commercial_id');
  const { rows } = await pool.query(`SELECT d.*, c.nom AS client_nom FROM devis d JOIN clients c ON c.id=d.client_id WHERE ${where.join(' AND ')}`, params); if (!rows.length) return res.status(404).json({ message: 'Devis introuvable.' });
  const { rows: lignes } = await pool.query('SELECT * FROM devis_lignes WHERE devis_id=$1 ORDER BY id', [rows[0].id]); res.json({ ...rows[0], montant_total: Number(rows[0].montant_total), lignes: lignes.map((l) => ({ ...l, quantite:Number(l.quantite), prix_unitaire:Number(l.prix_unitaire), remise_pourcentage:Number(l.remise_pourcentage), total_ligne:Number(l.total_ligne) })) });
}
async function create(req, res) {
  const { client_id: clientId, date_validite: dateValidite, note, lignes } = req.body; const client = await pool.connect();
  try { await client.query('BEGIN'); const { rows: clients } = await client.query('SELECT id FROM clients WHERE id=$1 AND entreprise_id=$2 AND actif', [clientId, req.user.entrepriseId]); if (!clients.length) throw Object.assign(new Error('Client introuvable ou archive.'), { status:400 }); const lignesOK=await lignesValides(client,lignes,req.user.entrepriseId); const total=number(lignesOK.reduce((s,l)=>s+l.total_ligne,0)); const no=await numero(client,'devis','DEV',req.user.entrepriseId); const { rows }=await client.query('INSERT INTO devis (entreprise_id,numero,client_id,commercial_id,date_validite,note,montant_total) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.user.entrepriseId,no,clientId,req.user.id,dateValidite||null,note||null,total]); for(const l of lignesOK) await client.query('INSERT INTO devis_lignes (devis_id,produit_id,description,quantite,prix_unitaire,remise_pourcentage,total_ligne) VALUES ($1,$2,$3,$4,$5,$6,$7)',[rows[0].id,l.produit_id,l.description,l.quantite,l.prix_unitaire,l.remise_pourcentage,l.total_ligne]); await logAudit(client,{typeOperation:'devis_creation',entiteId:rows[0].id,utilisateurId:req.user.id,entrepriseId:req.user.entrepriseId,details:{numero:no,montant_total:total,nombre_lignes:lignesOK.length}}); await client.query('COMMIT'); res.status(201).json({ ...rows[0], montant_total:total }); } catch(err) { await client.query('ROLLBACK'); if(err.status) return res.status(err.status).json({message:err.message}); throw err; } finally { client.release(); }
}
function transition(statut) { return async (req,res) => { const autorise = statut === 'envoye' ? ['brouillon'] : statut === 'accepte' || statut === 'refuse' ? ['envoye'] : []; const { rows }=await pool.query(`UPDATE devis SET statut=$1,updated_at=now() WHERE id=$2 AND entreprise_id=$3 AND statut = ANY($4) RETURNING *`,[statut,req.params.id,req.user.entrepriseId,autorise]); if(!rows.length) return res.status(409).json({message:'Transition de statut impossible.'}); await logAudit(pool,{typeOperation:`devis_${statut}`,entiteId:rows[0].id,utilisateurId:req.user.id,entrepriseId:req.user.entrepriseId,details:{numero:rows[0].numero}}); res.json({...rows[0],montant_total:Number(rows[0].montant_total)}); }; }
async function convertir(req,res) { const client=await pool.connect(); try { await client.query('BEGIN'); const {rows: ds}=await client.query('SELECT * FROM devis WHERE id=$1 AND entreprise_id=$2 FOR UPDATE',[req.params.id,req.user.entrepriseId]); const d=ds[0]; if(!d || d.statut!=='accepte') { await client.query('ROLLBACK'); return res.status(409).json({message:'Seul un devis accepte peut etre transforme.'}); } const no=await numero(client,'commandes_clients','CMD',req.user.entrepriseId); const {rows: cs}=await client.query('INSERT INTO commandes_clients (entreprise_id,numero,devis_id,client_id,commercial_id,note,montant_total) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.user.entrepriseId,no,d.id,d.client_id,d.commercial_id,d.note,d.montant_total]); await client.query(`INSERT INTO commandes_clients_lignes (commande_id,produit_id,description,quantite,prix_unitaire,remise_pourcentage,total_ligne) SELECT $1,produit_id,description,quantite,prix_unitaire,remise_pourcentage,total_ligne FROM devis_lignes WHERE devis_id=$2`,[cs[0].id,d.id]); await client.query(`UPDATE devis SET statut='transforme',updated_at=now() WHERE id=$1`,[d.id]); await logAudit(client,{typeOperation:'commande_creation',entiteId:cs[0].id,utilisateurId:req.user.id,entrepriseId:req.user.entrepriseId,details:{numero:no,devis_numero:d.numero,montant_total:Number(d.montant_total)}}); await client.query('COMMIT'); res.status(201).json({...cs[0],montant_total:Number(cs[0].montant_total)}); } catch(err){await client.query('ROLLBACK');throw err;} finally{client.release();} }
module.exports={list,getById,create,envoyer:transition('envoye'),accepter:transition('accepte'),refuser:transition('refuse'),convertir};
