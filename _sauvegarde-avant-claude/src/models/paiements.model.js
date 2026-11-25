// Paiements des jeux concours. Un paiement réussi crée la participation, dans la même transaction SQL.
const crypto = require('crypto');
const db = require('../config/db');
const { libelle } = require('../utils/libelles');
const { prixLisible } = require('./jeux.model');

// Notre référence, envoyée à KKiaPay (partnerId) puis relue pour retrouver le paiement
const nouvelleReference = () => crypto.randomBytes(16).toString('hex');

async function creer({ userId, jeuId, montant, fournisseur }) {
  const reference = nouvelleReference();
  await db.execute(
    'INSERT INTO paiements (reference, user_id, jeu_id, montant, fournisseur) VALUES (?, ?, ?, ?, ?)',
    [reference, userId, jeuId, montant, fournisseur]
  );
  return reference;
}

async function trouverParReference(reference) {
  if (typeof reference !== 'string' || !/^[a-f0-9]{32}$/.test(reference)) return null;
  const [lignes] = await db.execute('SELECT * FROM paiements WHERE reference = ?', [reference]);
  return lignes[0] || null;
}

/**
 * Marque le paiement réussi et crée la participation (tout ou rien).
 * Renvoie 'confirme' | 'deja-confirme' | 'transaction-deja-utilisee'.
 */
async function confirmer(paiement, { transactionId, operateur, telephone }) {
  const connexion = await db.getConnection();
  try {
    await connexion.beginTransaction();
    const [r] = await connexion.execute(
      `UPDATE paiements SET statut = 'reussi', transaction_id = ?, operateur = ?, telephone = ?, motif_echec = NULL, confirme_le = NOW()
       WHERE id = ? AND statut <> 'reussi'`,
      [transactionId, operateur, telephone, paiement.id]
    );
    if (r.affectedRows === 0) {
      await connexion.rollback();
      return 'deja-confirme';
    }
    // INSERT IGNORE : si le joueur avait déjà une participation (double paiement), elle n'est pas dupliquée
    await connexion.execute(
      'INSERT IGNORE INTO participations (jeu_id, user_id, paiement_id) VALUES (?, ?, ?)',
      [paiement.jeu_id, paiement.user_id, paiement.id]
    );
    await connexion.commit();
    return 'confirme';
  } catch (err) {
    await connexion.rollback();
    if (err.code === 'ER_DUP_ENTRY') return 'transaction-deja-utilisee';
    throw err;
  } finally {
    connexion.release();
  }
}

async function marquerEchec(paiementId, motif) {
  await db.execute(
    "UPDATE paiements SET statut = 'echoue', motif_echec = ? WHERE id = ? AND statut = 'en_attente'",
    [String(motif || 'Paiement non abouti').slice(0, 255), paiementId]
  );
}

// Administration : liste filtrée, plus récente d'abord
async function lister({ statut, jeuId } = {}) {
  const conditions = [];
  const valeurs = [];
  if (['en_attente', 'reussi', 'echoue'].includes(statut)) { conditions.push('pa.statut = ?'); valeurs.push(statut); }
  if (Number.isInteger(jeuId)) { conditions.push('pa.jeu_id = ?'); valeurs.push(jeuId); }
  const [lignes] = await db.execute(
    `SELECT pa.id, pa.reference, pa.montant, pa.fournisseur, pa.statut, pa.transaction_id, pa.operateur, pa.telephone,
            pa.motif_echec, pa.cree_le, pa.confirme_le, u.email, j.titre AS jeu
     FROM paiements pa LEFT JOIN users u ON u.id = pa.user_id LEFT JOIN jeux j ON j.id = pa.jeu_id
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY pa.cree_le DESC, pa.id DESC LIMIT 300`,
    valeurs
  );
  return lignes.map((p) => ({
    ...p,
    montant_libelle: prixLisible(p.montant),
    statut_libelle: libelle('statutPaiement', p.statut),
    operateur: p.operateur || '–',
    email: p.email || '(compte supprimé)'
  }));
}

async function totaux() {
  const [[ligne]] = await db.execute(
    "SELECT COUNT(*) AS nombre, COALESCE(SUM(montant), 0) AS recettes FROM paiements WHERE statut = 'reussi'"
  );
  return { nombre: Number(ligne.nombre), recettes: Number(ligne.recettes) };
}

module.exports = { creer, trouverParReference, confirmer, marquerEchec, lister, totaux };
