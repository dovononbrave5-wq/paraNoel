// Galerie des éditions passées : photos ajoutées par le super-administrateur.
const db = require('../config/db');

const SQL_TABLE = `
CREATE TABLE IF NOT EXISTS galerie_photos (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  edition  TINYINT UNSIGNED NOT NULL,                -- numéro de l'édition (1, 2, 3…)
  annee    SMALLINT DEFAULT NULL,
  legende  VARCHAR(150) DEFAULT NULL,
  image    VARCHAR(255) NOT NULL,                    -- /uploads/images/xxxx.jpg
  cree_le  DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_galerie_edition (edition, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

// Créée automatiquement au démarrage
async function creerTable() {
  await db.query(SQL_TABLE);
}

async function lister() {
  const [lignes] = await db.execute('SELECT id, edition, annee, legende, image, cree_le FROM galerie_photos ORDER BY edition DESC, id ASC');
  return lignes;
}

// Pour le site : regroupées par édition, la plus récente d'abord
async function listerParEdition() {
  const groupes = new Map();
  for (const p of await lister()) {
    if (!groupes.has(p.edition)) {
      groupes.set(p.edition, {
        edition: p.edition,
        edition_libelle: `${p.edition}${p.edition === 1 ? 're' : 'e'} édition`,
        annee: p.annee,
        photos: []
      });
    }
    const groupe = groupes.get(p.edition);
    groupe.annee ??= p.annee;
    groupe.photos.push({ id: p.id, image: p.image, legende: p.legende || '' });
  }
  return [...groupes.values()];
}

async function ajouter({ edition, annee, legende }, images) {
  for (const image of images) {
    await db.execute(
      'INSERT INTO galerie_photos (edition, annee, legende, image) VALUES (?, ?, ?, ?)',
      [edition, annee || null, legende || null, image]
    );
  }
}

async function trouver(id) {
  const [lignes] = await db.execute('SELECT * FROM galerie_photos WHERE id = ?', [id]);
  return lignes[0] || null;
}

async function supprimer(id) {
  await db.execute('DELETE FROM galerie_photos WHERE id = ?', [id]);
}

module.exports = { creerTable, lister, listerParEdition, ajouter, trouver, supprimer };
