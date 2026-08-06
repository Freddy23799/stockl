const { Pool, types } = require('pg');
const config = require('./index');

// Une colonne DATE porte un jour civil, sans heure ni fuseau : une date
// d'embauche, une periode de salaire, une echeance de piece d'identite.
//
// Par defaut, `pg` la convertit en objet Date JavaScript positionne a minuit
// dans le fuseau du serveur. Le jour se decale alors des qu'on la reserialise :
// une embauche saisie au 15 janvier ressortait au 13, parce que chaque passage
// par `toISOString()` reculait d'une heure sous minuit, donc d'un jour entier.
//
// On la laisse donc telle que PostgreSQL l'ecrit, en 'AAAA-MM-JJ'. C'est aussi
// ce que le frontend attend pour un <input type="date">, et cela supprime toute
// une famille de decalages a un jour.
const OID_DATE = 1082;
types.setTypeParser(OID_DATE, (valeur) => valeur);

// config.db contient soit { connectionString, ssl }, soit
// { host, port, user, database, password } - voir config/index.js.
// `origine` ne sert qu'au diagnostic, le pool n'en veut pas.
const { origine, ...optionsConnexion } = config.db;

const pool = new Pool(optionsConnexion);

module.exports = pool;
