// Reçu de paiement envoyé par e-mail (style ticket de caisse), avec le jeu
// et son questionnaire PDF en pièce jointe, tels que l'administrateur les a créés.
const Jeux = require('../models/jeux.model');
const User = require('../models/user.model');
const Evenement = require('../models/evenement.model');
const { sendRecuPaiement } = require('../config/mailer');
const Stockage = require('./stockage');

// « 2026-11-25 19:31:00 » → « 25/11/2026 à 19:31 »
function dateLisible(valeur) {
  const m = String(valeur || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}` : '';
}

// Numéro de reçu lisible : PN-2026-00012
const numeroRecu = (paiement) =>
  `PN-${String(paiement.confirme_le || paiement.cree_le || '').slice(0, 4) || new Date().getFullYear()}-${String(paiement.id).padStart(5, '0')}`;

// Seuls les 2 derniers chiffres du numéro restent visibles
function telephoneMasque(tel) {
  const chiffres = String(tel || '').replace(/\D/g, '');
  return chiffres.length >= 4 ? `•••• •• ${chiffres.slice(-2)}` : null;
}

const OPERATEURS = { 'mtn-benin': 'MTN Mobile Money', 'moov-benin': 'Moov Money', 'celtiis-benin': 'Celtiis Cash', simulation: 'Simulation (test)' };
const nomOperateur = (paiement) =>
  paiement.fournisseur === 'simulation' ? OPERATEURS.simulation : (OPERATEURS[paiement.operateur] || paiement.operateur || 'Mobile Money');

/**
 * Construit et envoie le reçu d'un paiement réussi (ligne complète de la table paiements).
 * Lance une erreur si l'envoi échoue.
 */
async function envoyerRecu(paiement) {
  if (!paiement || paiement.statut !== 'reussi') throw new Error('Reçu disponible seulement pour un paiement réussi');
  const [jeu, joueur, evenement] = await Promise.all([
    paiement.jeu_id ? Jeux.trouver(paiement.jeu_id) : null,
    User.findById(paiement.user_id),
    Evenement.lire()
  ]);
  if (!joueur) throw new Error('Compte du joueur introuvable');

  // Formulaire PDF ajouté par l'administrateur sur ce jeu : joint au reçu
  const pieces = [];
  if (jeu?.formulaire_pdf) {
    try {
      pieces.push({ nom: jeu.formulaire_nom || 'questionnaire.pdf', contenu: await Stockage.lire('formulaires', jeu.formulaire_pdf) });
    } catch (err) {
      console.error(`Formulaire PDF du jeu ${jeu.id} introuvable :`, err.message);
    }
  }

  const base = process.env.BASE_URL || '';
  await sendRecuPaiement(joueur.email, {
    numero: numeroRecu(paiement),
    date: dateLisible(paiement.confirme_le || paiement.cree_le),
    client: joueur.email,
    montant: Jeux.prixLisible(paiement.montant),
    operateur: nomOperateur(paiement),
    telephone: telephoneMasque(paiement.telephone),
    transaction: paiement.transaction_id || '',
    reference: String(paiement.reference).slice(0, 8).toUpperCase(),
    lien: `${base}/participer?jeu=${paiement.jeu_id}`,
    lienEspace: `${base}/dashboard`,
    pieces,
    jeu: {
      titre: jeu?.titre || 'Jeu concours',
      description: jeu?.description || '',
      reglement: jeu?.reglement || '',
      cases: jeu?.nb_reponses || 0,
      ouverture: dateLisible(jeu?.date_ouverture),
      cloture: dateLisible(jeu?.date_cloture)
    },
    evenement: {
      nom: evenement.nom || "Para'Noel",
      edition: evenement.edition || null,
      lieu: evenement.lieu || '',
      adresse: evenement.adresse || '',
      telephone: evenement.telephone || '',
      whatsapp: evenement.whatsapp || '',
      email: evenement.email || ''
    }
  });
}

module.exports = { envoyerRecu, numeroRecu };
