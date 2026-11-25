const db = require('../config/db');
// --- Lecture ---
async function findByEmail(email) {
  const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0] || null;
}
async function findById(id) {
  const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}
async function findByGoogleId(googleId) {
  const [rows] = await db.execute('SELECT * FROM users WHERE google_id = ?', [googleId]);
  return rows[0] || null;
}
async function findByAppleId(appleId) {
  const [rows] = await db.execute('SELECT * FROM users WHERE apple_id = ?', [appleId]);
  return rows[0] || null;
}
// --- Création ---
// Compte classique : passwordHash fourni, is_verified = 0
async function createUser(email, passwordHash) {
  const [result] = await db.execute(
    'INSERT INTO users (email, password_hash, is_verified) VALUES (?, ?, 0)',
    [email, passwordHash]
  );
  return result.insertId;
}
// Compte social (Google/Apple) : pas de mot de passe, e-mail déjà vérifié
async function createSocialUser(email, provider, providerId) {
  const column = provider === 'google' ? 'google_id' : 'apple_id'; // liste blanche, jamais d'entrée utilisateur
  const [result] = await db.execute(
    `INSERT INTO users (email, ${column}, is_verified) VALUES (?, ?, 1)`,
    [email, providerId]
  );
  return result.insertId;
}
// --- Mise à jour ---
async function markVerified(userId) {
  await db.execute('UPDATE users SET is_verified = 1 WHERE id = ?', [userId]);
}
// Lie un compte existant à Google ou Apple
async function linkProvider(userId, provider, providerId) {
  const column = provider === 'google' ? 'google_id' : 'apple_id';
  await db.execute(`UPDATE users SET ${column} = ?, is_verified = 1 WHERE id = ?`, [providerId, userId]);
}
async function updatePassword(userId, passwordHash) {
  await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
}
async function updateLastLogin(userId) {
  await db.execute('UPDATE users SET derniere_connexion = NOW() WHERE id = ?', [userId]);
}
async function setRole(userId, role) {
  await db.execute('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
}
async function setStatut(userId, statut) {
  await db.execute('UPDATE users SET statut = ? WHERE id = ?', [statut, userId]);
}

// --- Administration : liste filtrée et paginée des inscrits ---
// filtres : recherche (morceau d'e-mail), role, statut ('verifie' | 'non-verifie' | 'suspendu')
async function listUsers({ recherche, role, statut } = {}, page = 1, parPage = 20) {
  const conditions = [];
  const valeurs = [];
  if (recherche) { conditions.push('email LIKE ?'); valeurs.push(`%${recherche}%`); }
  if (role) { conditions.push('role = ?'); valeurs.push(role); }
  if (statut === 'verifie') conditions.push('is_verified = 1');
  if (statut === 'non-verifie') conditions.push('is_verified = 0');
  if (statut === 'suspendu') conditions.push("statut = 'suspendu'");
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM users ${where}`, valeurs);
  const [lignes] = await db.execute(
    `SELECT id, email, is_verified, role, statut, date_inscription, derniere_connexion,
            password_hash IS NOT NULL AS a_mot_de_passe, google_id IS NOT NULL AS a_google,
            apple_id IS NOT NULL AS a_apple
     FROM users ${where}
     ORDER BY date_inscription DESC, id DESC
     LIMIT ${Number(parPage)} OFFSET ${Number((page - 1) * parPage)}`,
    valeurs
  );
  return { lignes, total };
}

async function lastUsers(limite = 5) {
  const [rows] = await db.execute(
    `SELECT id, email, is_verified, date_inscription FROM users
     ORDER BY date_inscription DESC, id DESC LIMIT ${Number(limite)}`
  );
  return rows;
}

async function stats() {
  const [[ligne]] = await db.execute(`
    SELECT COUNT(*) AS inscrits,
           SUM(date_inscription >= NOW() - INTERVAL 7 DAY) AS nouveaux,
           SUM(is_verified = 0) AS non_verifies,
           SUM(role IN ('admin', 'super_admin')) AS admins
    FROM users`);
  return {
    inscrits: Number(ligne.inscrits) || 0,
    nouveaux: Number(ligne.nouveaux) || 0,
    non_verifies: Number(ligne.non_verifies) || 0,
    admins: Number(ligne.admins) || 0
  };
}
// --- Jetons de vérification d'e-mail ---
async function saveVerificationToken(userId, tokenHash, expiresAt) {
  // Un seul jeton actif par utilisateur : on supprime les anciens
  await db.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId]);
  await db.execute(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt]
  );
}
async function findValidToken(tokenHash) {
  const [rows] = await db.execute(
    'SELECT * FROM email_verification_tokens WHERE token_hash = ? AND expires_at > NOW()',
    [tokenHash]
  );
  return rows[0] || null;
}
async function deleteTokensForUser(userId) {
  await db.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId]);
}
module.exports = {
  findByEmail, findById, findByGoogleId, findByAppleId,
  createUser, createSocialUser,
  markVerified, linkProvider, updatePassword, updateLastLogin, setRole, setStatut,
  listUsers, lastUsers, stats,
  saveVerificationToken, findValidToken, deleteTokensForUser
};