const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5439,
  user: process.env.DB_USER || 'machibel',
  password: process.env.DB_PASSWORD || 'machibel',
  database: process.env.DB_NAME || 'machibel',
});

module.exports = pool;
