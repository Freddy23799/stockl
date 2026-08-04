require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const pool = require('../config/db');

// Cree le tout premier compte administrateur si aucun n'existe encore.
// Usage: node src/db/seed-admin.js <email> <password> [nom]
async function run() {
  const [, , email, password, nom] = process.argv;
  if (!email || !password) {
    console.error('Usage: node src/db/seed-admin.js <email> <password> [nom]');
    process.exit(1);
  }

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM utilisateurs WHERE role = 'admin'");
  if (rows[0].n > 0) {
    console.log('Un compte administrateur existe deja - rien a faire.');
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO utilisateurs (nom, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
    [nom || 'Administrateur', email, passwordHash]
  );
  console.log(`Compte administrateur cree : ${email}`);
  await pool.end();
}

run().catch((err) => {
  console.error('Echec du seed admin:', err.message);
  process.exit(1);
});
