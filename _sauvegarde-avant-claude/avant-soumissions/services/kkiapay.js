// Paiement Mobile Money avec KKiaPay (MTN, Moov, Celtiis).
//
// Principe de sécurité : le navigateur ouvre la fenêtre de paiement KKiaPay, puis nous envoie
// l'identifiant de la transaction. Le serveur ne le croit pas sur parole : il demande lui-même
// à KKiaPay (avec les clés secrètes) si la transaction a réussi et quel montant a été payé.
//
// Mode « simulation » (PAIEMENT_MODE=simulation) : aucun appel à KKiaPay, pour développer et tester
// sans compte marchand. Il est refusé en production.
const crypto = require('crypto');

const BASES = { sandbox: 'https://api-sandbox.kkiapay.me', live: 'https://api.kkiapay.me' };
const estProduction = () => process.env.NODE_ENV === 'production';

function mode() {
  return process.env.PAIEMENT_MODE === 'kkiapay' ? 'kkiapay' : 'simulation';
}

const enSandbox = () => process.env.KKIAPAY_SANDBOX !== 'false';

// Vérifie au démarrage que la configuration est cohérente (message clair plutôt qu'un échec au premier paiement)
function verifierConfiguration() {
  if (mode() === 'simulation') {
    if (estProduction()) console.error('ATTENTION : PAIEMENT_MODE=simulation en production — les paiements seront refusés.');
    else console.warn('Paiements en mode simulation (aucun argent réel). Mettez PAIEMENT_MODE=kkiapay pour KKiaPay.');
    return;
  }
  const manquantes = ['KKIAPAY_PUBLIC_KEY', 'KKIAPAY_PRIVATE_KEY', 'KKIAPAY_SECRET_KEY'].filter((k) => !process.env[k]);
  if (manquantes.length) console.error(`KKiaPay : variables manquantes dans .env : ${manquantes.join(', ')}`);
  console.log(`Paiements KKiaPay en mode ${enSandbox() ? 'test (sandbox)' : 'réel'}`);
}

// Ce que le navigateur a le droit de connaître (jamais les clés privée et secrète)
function configurationPublique() {
  return {
    mode: mode(),
    cle_publique: mode() === 'kkiapay' ? process.env.KKIAPAY_PUBLIC_KEY || '' : null,
    sandbox: mode() === 'kkiapay' ? enSandbox() : true
  };
}

/**
 * Demande à KKiaPay l'état d'une transaction.
 * Renvoie { reussi, montant, operateur, telephone, partnerId, motif }.
 */
async function verifierTransaction(transactionId) {
  if (mode() === 'simulation') {
    if (estProduction()) return { reussi: false, motif: 'Mode simulation interdit en production' };
    return { reussi: true, montant: null, operateur: 'simulation', telephone: null, partnerId: null, motif: null };
  }

  let reponse;
  try {
    reponse = await fetch(`${enSandbox() ? BASES.sandbox : BASES.live}/api/v1/transactions/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.KKIAPAY_PUBLIC_KEY,
        'x-private-key': process.env.KKIAPAY_PRIVATE_KEY,
        'x-secret-key': process.env.KKIAPAY_SECRET_KEY
      },
      body: JSON.stringify({ transactionId }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    const erreur = new Error('KKiaPay ne répond pas, réessayez dans un instant');
    erreur.status = 503;
    throw erreur;
  }

  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    return { reussi: false, motif: donnees.reason || donnees.message || `Transaction introuvable (${reponse.status})` };
  }
  return {
    reussi: donnees.status === 'SUCCESS',
    montant: Number(donnees.amount),
    operateur: donnees.source_common_name || donnees.source || null,
    telephone: donnees.client?.phone ? String(donnees.client.phone) : null,
    partnerId: donnees.partnerId || donnees.state?.partnerId || null,
    motif: donnees.status === 'SUCCESS' ? null : (donnees.failureMessage || donnees.status || 'Paiement non abouti')
  };
}

// Le webhook KKiaPay envoie dans l'en-tête « x-kkiapay-secret » le secret choisi dans le tableau de bord
function webhookAuthentique(enTete) {
  const attendu = process.env.KKIAPAY_WEBHOOK_SECRET;
  if (!attendu || typeof enTete !== 'string') return false;
  const a = Buffer.from(enTete);
  const b = Buffer.from(attendu);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { mode, verifierConfiguration, configurationPublique, verifierTransaction, webhookAuthentique };
