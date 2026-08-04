async function logAudit(client, { typeOperation, entiteId = null, utilisateurId = null, details = null }) {
  await client.query(
    `INSERT INTO historique_audit (type_operation, entite_id, utilisateur_id, details)
     VALUES ($1, $2, $3, $4)`,
    [typeOperation, entiteId, utilisateurId, details ? JSON.stringify(details) : null]
  );
}

module.exports = { logAudit };
