// Formulaire de contact public. Monté sur /api dans app.js.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../config/db');
const { contactRules, handleValidation } = require('../middlewares/validate');
const { sendContactEmail } = require('../config/mailer');
const { journaliser, ipDe } = require('../utils/journal');
const { libelle } = require('../utils/libelles');

const router = express.Router();

// 5 envois par quart d'heure et par adresse IP : protège contre le spam
const limiteur = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.FORM_RATE_LIMIT) || 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop d\'envois depuis votre connexion. Réessayez dans quelques minutes.' }
});

const MERCI = 'Merci ! Votre message a bien été envoyé. Nous vous répondons rapidement.';

// Piège à robots : le champ caché « site_web » est rempli → on fait semblant d'accepter, sans rien enregistrer
const piegeARobots = (req, res, next) => (req.body?.site_web ? res.status(201).json({ message: MERCI }) : next());

router.post('/contact', limiteur, piegeARobots, contactRules, handleValidation, async (req, res, next) => {
  try {
    const { nom, email, telephone, objet, message } = req.body;
    await db.execute(
      'INSERT INTO messages_contact (nom, email, telephone, objet, message, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [nom, email, telephone || null, objet, message, ipDe(req)]
    );
    await journaliser(req, 'message', `Message de ${nom} (${libelle('objet', objet)})`, { email });

    // L'e-mail est un plus : le message est déjà enregistré, un échec d'envoi ne bloque pas la réponse
    sendContactEmail({ nom, email, telephone, message, objet_libelle: libelle('objet', objet) })
      .catch((err) => console.error('Notification de contact non envoyée :', err.message));

    res.status(201).json({ message: MERCI });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
