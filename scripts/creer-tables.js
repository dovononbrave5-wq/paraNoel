// Crée la base et toutes les tables (sql/schema.sql) sur le serveur MySQL indiqué dans .env.
// Utile pour une base en ligne (Render, TiDB Cloud…) sans phpMyAdmin.
// Usage :  npm run creer-tables
// Sans risque : le script peut être relancé, il ne supprime rien (CREATE … IF NOT EXISTS).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const nomBase = process.env.DB_NAME || 'para_noel';
  if (!/^[A-Za-z0-9_]+$/.test(nomBase)) {
    console.error('✘ DB_NAME ne doit contenir que des lettres, chiffres et _');
    process.exitCode = 1;
    return;
  }
  // Le fichier crée la base « para_noel » : on utilise le nom choisi dans DB_NAME
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8')
    .replace(/\bpara_noel\b/g, nomBase);

  let connexion;
  try {
    connexion = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      charset: 'utf8mb4',
      multipleStatements: true,
      ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
    });
    console.log(`Connexion à ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}…`);
    await connexion.query(sql);
    const [tables] = await connexion.query(`SHOW TABLES FROM \`${nomBase}\``);
    console.log(`✔ Base « ${nomBase} » prête : ${tables.length} tables.`);
  } catch (err) {
    console.error('✘ Échec :', err.code || '', err.message);
    if (err.code === 'HANDSHAKE_SSL_ERROR' || /secure|ssl|tls/i.test(err.message)) console.error('→ Cette base exige une connexion chiffrée : ajoutez DB_SSL=true dans .env');
    process.exitCode = 1;
  } finally {
    if (connexion) await connexion.end();
  }
})();
