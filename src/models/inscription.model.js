// Inscriptions en attente : l'adresse e-mail n'entre dans la table « users »
// qu'après avoir cliqué sur le lien de confirmation.
const db = require('../config/db');

const SQL_TABLE = `
CREATE TABLE IF NOT EXISTS inscriptions_en_attente (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  token_hash    CHAR(64) NOT NULL,
  expires_at    DATETIME NOT NULL,
  cree_le       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_attente_email (email),
  UNIQUE KEY uq_attente_token (token_hash),
  INDEX idx_attente_expiration (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

// Créée automatiquement au démarrage (inutile de réimporter schema.sql)
async function creerTable() {
  await db.query(SQL_TABLE);
  await db.execute('DELETE FROM inscriptions_en_attente WHERE expires_at < NOW() - INTERVAL 7 DAY');
}

// Nouvelle demande, ou remplacement de la précédente (nouveau mot de passe, nouveau lien)
async function enregistrer(email, passwordHash, tokenHash, expiresAt) {
  await db.execute(
    `INSERT INTO inscriptions_en_attente (email, password_hash, token_hash, expires_at) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), token_hash = VALUES(token_hash),
                             expires_at = VALUES(expires_at), cree_le = NOW()`,
    [email, passwordHash, tokenHash, expiresAt]
  );
}

// Nouveau lien pour une demande existante (sans changer le mot de passe)
async function renouvelerJeton(email, tokenHash, expiresAt) {
  const [r] = await db.execute(
    'UPDATE inscriptions_en_attente SET token_hash = ?, expires_at = ? WHERE email = ?',
    [tokenHash, expiresAt, email]
  );
  return r.affectedRows > 0;
}

async function trouverParEmail(email) {
  const [rows] = await db.execute('SELECT * FROM inscriptions_en_attente WHERE email = ?', [email]);
  return rows[0] || null;
}

async function trouverParJeton(tokenHash) {
  const [rows] = await db.execute(
    'SELECT * FROM inscriptions_en_attente WHERE token_hash = ? AND expires_at > NOW()',
    [tokenHash]
  );
  return rows[0] || null;
}

async function supprimer(email) {
  await db.execute('DELETE FROM inscriptions_en_attente WHERE email = ?', [email]);
}

module.exports = { creerTable, enregistrer, renouvelerJeton, trouverParEmail, trouverParJeton, supprimer };
