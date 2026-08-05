const { Pool } = require('pg');
const config = require('./index');

// config.db contient soit { connectionString, ssl }, soit
// { host, port, user, database, password } - voir config/index.js.
// `origine` ne sert qu'au diagnostic, le pool n'en veut pas.
const { origine, ...optionsConnexion } = config.db;

const pool = new Pool(optionsConnexion);

module.exports = pool;
