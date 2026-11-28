// Photos de la section « Notre histoire » (accueil et « À propos ») :
// autant de photos que le super-administrateur le souhaite, affichées en diaporama.
const db = require('../config/db');

const SQL_TABLE = `
CREATE TABLE IF NOT EXISTS accueil_photos (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  image    VARCHAR(255) NOT NULL,                    -- /uploads/images/xxxx.jpg
  legende  VARCHAR(150) DEFAULT NULL,
  cree_le  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

// Créée automatiquement au démarrage. L'ancienne photo unique (evenement.image_apropos)
// est reprise une seule fois comme première photo du diaporama.
async function creerTable() {
  await db.query(SQL_TABLE);
  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM accueil_photos');
  if (total > 0) return;
  const [lignes] = await db.query('SELECT image_apropos FROM evenement WHERE id = 1');
  const ancienne = lignes[0] && lignes[0].image_apropos;
  if (!ancienne) return;
  await db.execute('INSERT INTO accueil_photos (image) VALUES (?)', [ancienne]);
  await db.execute('UPDATE evenement SET image_apropos = NULL WHERE id = 1');
}

async function lister() {
  const [lignes] = await db.execute('SELECT id, image, legende FROM accueil_photos ORDER BY id ASC');
  return lignes.map((p) => ({ id: p.id, image: p.image, legende: p.legende || '' }));
}

async function ajouter(legende, images) {
  for (const image of images) {
    await db.execute('INSERT INTO accueil_photos (image, legende) VALUES (?, ?)', [image, legende || null]);
  }
}

async function trouver(id) {
  const [lignes] = await db.execute('SELECT * FROM accueil_photos WHERE id = ?', [id]);
  return lignes[0] || null;
}

async function supprimer(id) {
  await db.execute('DELETE FROM accueil_photos WHERE id = ?', [id]);
}

module.exports = { creerTable, lister, ajouter, trouver, supprimer };