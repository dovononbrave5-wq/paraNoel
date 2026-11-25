// Espace membre : tableau de bord et réglages du compte. Monté sur /api dans app.js.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/user.model');
const Jeux = require('../models/jeux.model');
const Paiements = require('../models/paiements.model');
const Evenement = require('../models/evenement.model');
const { requireAuth } = require('../middlewares/auth');
const { changerMotDePasseRules, handleValidation } = require('../middlewares/validate');
const { libelle } = require('../utils/libelles');
const { journaliser } = require('../utils/journal');
const { envoyerRecu } = require('../services/recu');

const router = express.Router();
const sansCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

const limiteurMotDePasse = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' }
});

// Tout ce que la page « Mon espace » affiche, en une seule requête
router.get('/me/tableau-de-bord', requireAuth, sansCache, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const [participations, paiements, jeux, evenement] = await Promise.all([
      Jeux.mesParticipations(user.id),
      Paiements.mesPaiements(user.id),
      Jeux.listerPublic({}),
      Evenement.lire()
    ]);

    // Jeux ouverts ou à venir auxquels le membre ne participe pas encore
    const dejaInscrit = new Set(participations.map((p) => p.jeu_id));
    const aDecouvrir = jeux
      .filter((j) => j.phase !== 'clos' && !dejaInscrit.has(j.id))
      .slice(0, 4)
      .map((j) => ({
        id: j.id, titre: j.titre, phase: j.phase, phase_libelle: libelle('phaseJeu', j.phase),
        prix_libelle: j.prix_libelle, date_ouverture: j.date_ouverture, date_cloture: j.date_cloture,
        duree_minutes: j.duree_minutes
      }));

    // Rencontres en présentiel publiées pour les jeux du membre, la plus proche d'abord
    const rencontres = participations
      .filter((p) => p.rencontre && p.rencontre.date)
      .map((p) => ({ jeu: p.titre, retenu: p.resultat === 'retenu', ...p.rencontre }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const reussis = paiements.filter((p) => p.statut === 'reussi');

    res.json({
      compte: {
        id: user.id,
        email: user.email,
        role: user.role,
        role_libelle: libelle('role', user.role),
        verifie: Boolean(user.is_verified),
        inscrit_le: user.date_inscription,
        derniere_connexion: user.derniere_connexion,
        connexion_google: Boolean(user.google_id),
        a_mot_de_passe: Boolean(user.password_hash)
      },
      statistiques: {
        participations: participations.length,
        a_terminer: participations.filter((p) => p.statut !== 'terminee' && p.phase === 'ouvert').length,
        retenues: participations.filter((p) => p.resultat === 'retenu').length,
        depense: reussis.reduce((total, p) => total + p.montant, 0),
        depense_libelle: Jeux.prixLisible(reussis.reduce((total, p) => total + p.montant, 0))
      },
      evenement: {
        nom: evenement.nom,
        edition: evenement.edition,
        date: evenement.date_evenement || null,
        lieu: evenement.lieu || null
      },
      participations,
      paiements,
      jeux: aDecouvrir,
      rencontres
    });
  } catch (err) {
    next(err);
  }
});

// Changer (ou créer, pour un compte Google) son mot de passe
router.post('/me/mot-de-passe', requireAuth, limiteurMotDePasse, changerMotDePasseRules, handleValidation, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (user.password_hash) {
      const ok = typeof req.body.actuel === 'string' && await bcrypt.compare(req.body.actuel, user.password_hash);
      if (!ok) {
        return res.status(400).json({ errors: [{ champ: 'actuel', message: 'Ton mot de passe actuel est incorrect.' }] });
      }
    }
    await User.updatePassword(user.id, await bcrypt.hash(req.body.nouveau, 12));
    await journaliser(req, 'compte', user.password_hash ? 'Mot de passe modifié' : 'Mot de passe ajouté', user);
    res.json({ message: user.password_hash ? 'Ton mot de passe a été modifié.' : 'Ton mot de passe est créé : tu peux aussi te connecter avec ton e-mail.' });
  } catch (err) {
    next(err);
  }
});

// Renvoyer le reçu d'un de mes paiements réussis sur mon e-mail
const limiteurRecu = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' }
});

router.post('/me/paiements/:reference/recu', requireAuth, limiteurRecu, async (req, res, next) => {
  try {
    const paiement = await Paiements.trouverParReference(req.params.reference);
    if (!paiement || paiement.user_id !== req.user.id) return res.status(404).json({ error: 'Paiement introuvable' });
    if (paiement.statut !== 'reussi') return res.status(409).json({ error: 'Le reçu est disponible uniquement pour un paiement réussi.' });
    try {
      await envoyerRecu(paiement);
    } catch (err) {
      console.error('Renvoi du reçu impossible :', err.message);
      return res.status(502).json({ error: 'Le reçu n\'a pas pu être envoyé pour le moment. Réessaie dans quelques minutes.' });
    }
    res.json({ message: `Ton reçu vient d'être envoyé à ${req.user.email}.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
