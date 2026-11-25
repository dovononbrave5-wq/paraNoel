// Un « pool » garde quelques connexions MySQL ouvertes et les partage entre les requêtes.
// Tout le projet l'utilise de la même façon :  const db = require('../config/db');
//                                              const [rows] = await db.execute('SELECT …', [valeurs]);
const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'para_noel',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  // Les dates arrivent en texte « AAAA-MM-JJ HH:MM:SS », sans conversion de fuseau horaire
  dateStrings: true,
  // Bases en ligne (TiDB Cloud, Aiven…) : connexion chiffrée obligatoire → DB_SSL=true dans .env
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
});

// Appelé au démarrage pour afficher un message clair si MySQL est éteint ou mal configuré
async function verifierConnexion() {
  try {
    await db.query('SELECT 1');
    console.log(`Base de données connectée (${process.env.DB_NAME || 'para_noel'})`);
  } catch (err) {
    console.error(`Connexion à MySQL impossible : ${err.code || err.message}.`,
      'Vérifiez que MySQL est démarré et les variables DB_* du fichier .env.');
  }
}

module.exports = db;
module.exports.verifierConnexion = verifierConnexion;
