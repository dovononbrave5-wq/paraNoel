// Parcours « Participer » : paiement Mobile Money, questionnaire PDF, puis envoi des réponses (cases ou photos).
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
const upload = require('../middlewares/upload');

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
    if (!req.jeu.a_formulaire) return res.status(409).json({ error: 'Le questionnaire de ce jeu n\'est pas encore prêt.' });
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
    res.json({ message: 'Paiement confirmé. Télécharge le questionnaire et envoie tes réponses avant la date de clôture.' });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   3. Questionnaire PDF et envoi des réponses (cases de texte et/ou photos)
   Le joueur peut modifier ses réponses autant de fois qu'il veut jusqu'à la clôture.
   --------------------------------------------------------------------- */

// Vérifie que le joueur a payé ce jeu : la participation est placée dans req.participation
async function chargerParticipation(req, res, next) {
  try {
    const participation = await Jeux.trouverParticipation(req.jeu.id, req.user.id);
    if (!participation) return res.status(403).json({ error: 'Achète d\'abord ce questionnaire pour y accéder.' });
    req.participation = participation;
    next();
  } catch (err) {
    next(err);
  }
}

// Télécharger le questionnaire PDF (réservé aux joueurs qui l'ont acheté)
router.get('/jeux/:id/formulaire', requireAuth, sansCache, chargerJeu, chargerParticipation, async (req, res, next) => {
  try {
    const jeu = await Jeux.trouver(req.jeu.id);
    const chemin = upload.cheminFormulaire(jeu?.formulaire_pdf);
    if (!chemin) return res.status(404).json({ error: 'Le questionnaire PDF n\'est pas encore disponible.' });
    res.download(chemin, jeu.formulaire_nom || 'questionnaire.pdf', (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Questionnaire PDF introuvable.' });
    });
  } catch (err) {
    next(err);
  }
});

// Vérifications AVANT de recevoir les photos (rien n'est enregistré si l'envoi est refusé)
function peutSoumettre(req, res, next) {
  if (req.jeu.phase === 'clos') return res.status(409).json({ error: 'La date de clôture est passée : les réponses ne peuvent plus être envoyées ni modifiées.' });
  if (req.jeu.phase !== 'ouvert') return res.status(409).json({ error: 'Les réponses ne sont pas encore ouvertes pour ce jeu.' });
  next();
}

router.post('/jeux/:id/soumission', requireAuth, limiteurPaiement, chargerJeu, chargerParticipation, peutSoumettre,
  upload.photosReponses(), async (req, res, next) => {
    const nouvelles = req.photos || [];
    try {
      // Textes des cases reponse_1 … reponse_N (au-delà de N : ignorés)
      const reponses = [];
      for (let n = 1; n <= req.jeu.nb_reponses; n++) {
        const brut = req.body?.[`reponse_${n}`];
        const texte = typeof brut === 'string' ? brut.trim() : '';
        if (texte.length > 1000) {
          nouvelles.forEach(upload.supprimerPhotoReponse);
          return res.status(400).json({ errors: [{ champ: `reponse_${n}`, message: `Case ${n} : 1 000 caractères maximum` }] });
        }
        reponses.push(texte);
      }

      // Photos : les nouvelles remplacent les anciennes ; sinon on garde les anciennes (sauf demande de retrait)
      const retirer = ['on', 'true', '1'].includes(String(req.body?.retirer_photos || '').toLowerCase());
      const anciennes = req.participation.photos;
      const photos = nouvelles.length ? nouvelles : (retirer ? [] : undefined);
      const photosFinales = photos ?? anciennes;

      if (!reponses.some(Boolean) && !photosFinales.length) {
        nouvelles.forEach(upload.supprimerPhotoReponse);
        return res.status(400).json({ errors: [{ champ: 'reponse_1', message: 'Remplis au moins une case ou ajoute une photo de tes réponses.' }] });
      }

      await Jeux.enregistrerSoumission(req.participation.id, reponses, photos);
      if (photos !== undefined) anciennes.forEach(upload.supprimerPhotoReponse);

      const modification = req.participation.statut === 'terminee';
      await journaliser(req, 'jeu', `Réponses ${modification ? 'modifiées' : 'envoyées'} pour « ${req.jeu.titre} » (${reponses.filter(Boolean).length} case(s), ${photosFinales.length} photo(s))`);
      res.json({
        message: modification
          ? 'Tes réponses ont été mises à jour.'
          : 'Merci ! Tes réponses sont enregistrées. Tu peux encore les modifier jusqu\'à la date de clôture.',
        participation: Jeux.versionParticipant(await Jeux.trouverParticipation(req.jeu.id, req.user.id))
      });
    } catch (err) {
      nouvelles.forEach(upload.supprimerPhotoReponse);
      next(err);
    }
  });

// Revoir une de ses photos envoyées (n = 1, 2, …)
router.get('/jeux/:id/mes-photos/:n', requireAuth, sansCache, chargerJeu, chargerParticipation, (req, res) => {
  const n = idValide(req.params.n);
  const chemin = n && upload.cheminPhotoReponse(req.participation.photos[n - 1]);
  if (!chemin) return res.status(404).json({ error: 'Photo introuvable' });
  res.sendFile(chemin, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'Photo introuvable' }); });
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
