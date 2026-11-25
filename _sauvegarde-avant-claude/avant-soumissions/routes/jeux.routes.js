// Parcours « Participer » : paiement Mobile Money, puis questionnaire chronométré.
// Monté sur /api dans app.js. Toutes les routes /api/jeux/... exigent d'être connecté.
const express = require('express');
const rateLimit = require('express-rate-limit');
const Jeux = require('../models/jeux.model');
const Paiements = require('../models/paiements.model');
const kkiapay = require('../services/kkiapay');
const User = require('../models/user.model');
const { requireAuth } = require('../middlewares/auth');
const { envoyerRecu } = require('../services/recu');
const { journaliser } = require('../utils/journal');

const router = express.Router();

const limiteurPaiement = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PAIEMENT_RATE_LIMIT) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de paiement. Réessayez dans quelques minutes.' }
});

const idValide = (valeur) => {
  const n = Number.parseInt(valeur, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(valeur) ? n : null;
};

// Charge le jeu publié de l'adresse (/api/jeux/:id/...) dans req.jeu
async function chargerJeu(req, res, next) {
  try {
    const id = idValide(req.params.id);
    const jeu = id && await Jeux.trouverPublic(id);
    if (!jeu) return res.status(404).json({ error: 'Jeu introuvable' });
    req.jeu = jeu;
    next();
  } catch (err) {
    next(err);
  }
}

const sansCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

/* ---------------------------------------------------------------------
   Confirmation d'un paiement : utilisée par le navigateur ET par le webhook
   --------------------------------------------------------------------- */
async function finaliserPaiement(req, paiement, transactionId) {
  if (paiement.statut === 'reussi') return { ok: true, deja: true };

  const verification = await kkiapay.verifierTransaction(transactionId);
  const idTransaction = kkiapay.mode() === 'simulation' ? `SIM-${paiement.reference}` : String(transactionId);

  // Le serveur exige : transaction réussie, montant suffisant, et (si fournie) notre référence
  let motif = null;
  if (!verification.reussi) motif = verification.motif || 'Paiement non abouti';
  else if (verification.montant !== null && verification.montant < paiement.montant) motif = `Montant payé insuffisant (${verification.montant} au lieu de ${paiement.montant} FCFA)`;
  else if (verification.partnerId && verification.partnerId !== paiement.reference) motif = 'Cette transaction ne correspond pas à ce paiement';

  if (motif) {
    await Paiements.marquerEchec(paiement.id, motif);
    await journaliser(req, 'paiement', `Paiement refusé (${paiement.montant} FCFA) : ${motif}`);
    return { ok: false, motif };
  }

  const resultat = await Paiements.confirmer(paiement, {
    transactionId: idTransaction,
    operateur: verification.operateur,
    telephone: verification.telephone
  });
  if (resultat === 'transaction-deja-utilisee') {
    await journaliser(req, 'paiement', `Transaction ${idTransaction} déjà utilisée pour un autre paiement`);
    return { ok: false, motif: 'Cette transaction a déjà servi pour un autre paiement' };
  }
  if (resultat === 'confirme') {
    const jeu = await Jeux.trouver(paiement.jeu_id);
    const joueur = await User.findById(paiement.user_id);
    await journaliser(req, 'paiement', `Paiement de ${paiement.montant} FCFA reçu pour « ${jeu?.titre} » (${verification.operateur || 'Mobile Money'})`, joueur);
    // Reçu par e-mail (ticket + jeu créé par l'administrateur) : un échec d'envoi ne bloque pas la participation
    Paiements.trouverParReference(paiement.reference)
      .then(envoyerRecu)
      .catch((err) => console.error('Reçu de paiement non envoyé :', err.message));
  }
  return { ok: true };
}

/* ---------------------------------------------------------------------
   Participant connecté
   --------------------------------------------------------------------- */

// État de ma participation à un jeu (et configuration du paiement pour la page)
router.get('/jeux/:id/ma-participation', requireAuth, sansCache, chargerJeu, async (req, res, next) => {
  try {
    const participation = await Jeux.trouverParticipation(req.jeu.id, req.user.id);
    res.json({
      jeu: req.jeu,
      participation: Jeux.versionParticipant(participation),
      paiement: kkiapay.configurationPublique()
    });
  } catch (err) {
    next(err);
  }
});

// 1. Préparer un paiement : le serveur fixe le montant (jamais le navigateur)
router.post('/jeux/:id/paiement', requireAuth, limiteurPaiement, chargerJeu, async (req, res, next) => {
  try {
    if (req.jeu.phase !== 'ouvert') return res.status(409).json({ error: 'Les participations à ce jeu ne sont pas ouvertes.' });
    if (req.jeu.nb_questions === 0) return res.status(409).json({ error: 'Le questionnaire de ce jeu n\'est pas encore prêt.' });
    if (await Jeux.trouverParticipation(req.jeu.id, req.user.id)) {
      return res.status(409).json({ error: 'Vous participez déjà à ce jeu.' });
    }
    if (kkiapay.mode() === 'simulation' && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Le paiement n\'est pas encore configuré. Réessayez plus tard.' });
    }

    const reference = await Paiements.creer({
      userId: req.user.id, jeuId: req.jeu.id, montant: req.jeu.prix, fournisseur: kkiapay.mode()
    });
    res.status(201).json({
      ...kkiapay.configurationPublique(),
      reference,
      montant: req.jeu.prix,
      montant_libelle: req.jeu.prix_libelle,
      email: req.user.email
    });
  } catch (err) {
    next(err);
  }
});

// 2. Confirmer : le navigateur envoie l'identifiant donné par KKiaPay, le serveur le vérifie auprès de KKiaPay
router.post('/jeux/:id/paiement/confirmer', requireAuth, limiteurPaiement, chargerJeu, async (req, res, next) => {
  try {
    const { reference, transactionId } = req.body || {};
    const paiement = await Paiements.trouverParReference(reference);
    if (!paiement || paiement.user_id !== req.user.id || paiement.jeu_id !== req.jeu.id) {
      return res.status(404).json({ error: 'Paiement introuvable' });
    }
    if (kkiapay.mode() === 'kkiapay' && (typeof transactionId !== 'string' && typeof transactionId !== 'number')) {
      return res.status(400).json({ error: 'Identifiant de transaction manquant' });
    }

    const resultat = await finaliserPaiement(req, paiement, transactionId);
    if (!resultat.ok) return res.status(402).json({ error: `Paiement non validé : ${resultat.motif}` });
    res.json({ message: 'Paiement confirmé. Vous pouvez commencer le questionnaire.' });
  } catch (err) {
    next(err);
  }
});

// 3. Démarrer le questionnaire : le chronomètre part maintenant, côté serveur
router.post('/jeux/:id/demarrer', requireAuth, chargerJeu, async (req, res, next) => {
  try {
    const participation = await Jeux.trouverParticipation(req.jeu.id, req.user.id);
    if (!participation) return res.status(403).json({ error: 'Payez votre participation avant de commencer.' });
    if (participation.statut === 'terminee') return res.status(409).json({ error: 'Vous avez déjà répondu à ce questionnaire.' });
    if (participation.statut === 'payee') {
      if (req.jeu.phase !== 'ouvert') return res.status(409).json({ error: 'Le questionnaire est clôturé.' });
      await Jeux.demarrer(participation.id);
      await journaliser(req, 'jeu', `Questionnaire « ${req.jeu.titre} » commencé`);
    }
    res.json({ message: 'C\'est parti !' });
  } catch (err) {
    next(err);
  }
});

// 4. Les questions, SANS les bonnes réponses, avec le temps restant
router.get('/jeux/:id/questionnaire', requireAuth, sansCache, chargerJeu, async (req, res, next) => {
  try {
    const participation = await Jeux.trouverParticipation(req.jeu.id, req.user.id);
    if (!participation || participation.statut !== 'en_cours') {
      return res.status(403).json({ error: 'Questionnaire non disponible.' });
    }
    // Temps largement dépassé (page abandonnée) : la participation est close
    if (participation.secondes_restantes < -Jeux.TOLERANCE_SECONDES) {
      await Jeux.terminer(participation, {}, { enRetard: true });
      return res.status(409).json({ error: 'Le temps est écoulé.' });
    }
    res.json({
      titre: req.jeu.titre,
      secondes_restantes: Math.max(0, participation.secondes_restantes),
      questions: await Jeux.lireQuestions(req.jeu.id)
    });
  } catch (err) {
    next(err);
  }
});

// 5. Envoyer les réponses (une seule fois) : correction automatique côté serveur
router.post('/jeux/:id/reponses', requireAuth, chargerJeu, async (req, res, next) => {
  try {
    const participation = await Jeux.trouverParticipation(req.jeu.id, req.user.id);
    if (!participation || participation.statut !== 'en_cours') {
      return res.status(409).json({ error: 'Vos réponses ont déjà été enregistrées.' });
    }
    const reponses = req.body?.reponses;
    if (reponses !== undefined && (typeof reponses !== 'object' || Array.isArray(reponses) || reponses === null)) {
      return res.status(400).json({ error: 'Réponses invalides' });
    }
    const enRetard = participation.secondes_restantes < -Jeux.TOLERANCE_SECONDES;
    const ok = await Jeux.terminer(participation, reponses || {}, { enRetard });
    if (!ok) return res.status(409).json({ error: 'Vos réponses ont déjà été enregistrées.' });

    await journaliser(req, 'jeu', `Questionnaire « ${req.jeu.titre} » terminé${enRetard ? ' (hors délai)' : ''}`);
    res.json({
      message: enRetard
        ? 'Le temps était écoulé : vos réponses n\'ont pas pu être prises en compte.'
        : 'Merci ! Vos réponses sont enregistrées. La date de la rencontre en présentiel sera publiée sur le site.'
    });
  } catch (err) {
    next(err);
  }
});

// Espace membre : toutes mes participations
router.get('/me/participations', requireAuth, sansCache, async (req, res, next) => {
  try {
    res.json(await Jeux.mesParticipations(req.user.id));
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   Webhook KKiaPay : prévient le serveur même si le joueur a fermé la page
   (à déclarer dans le tableau de bord KKiaPay : <BASE_URL>/api/paiements/kkiapay/webhook)
   --------------------------------------------------------------------- */
router.post('/paiements/kkiapay/webhook', async (req, res) => {
  if (!kkiapay.webhookAuthentique(req.get('x-kkiapay-secret'))) {
    return res.status(401).json({ error: 'Signature invalide' });
  }
  // Réponse immédiate : KKiaPay n'attend pas la fin du traitement
  res.json({ recu: true });

  try {
    const { transactionId, partnerId, event } = req.body || {};
    if (event !== 'transaction.success' || !transactionId) return;
    const paiement = await Paiements.trouverParReference(partnerId);
    if (!paiement) return console.warn(`Webhook KKiaPay : référence inconnue (${partnerId})`);
    await finaliserPaiement(req, paiement, transactionId); // revérifie auprès de KKiaPay
  } catch (err) {
    console.error('Webhook KKiaPay :', err.message);
  }
});

module.exports = router;
