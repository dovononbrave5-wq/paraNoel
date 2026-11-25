// API publique, lue par site.js et listes.js : uniquement ce qui est visible / publié.
// Montée sur /api/public dans app.js.
const express = require('express');
const Evenement = require('../models/evenement.model');
const Contenus = require('../models/contenus.model');
const Jeux = require('../models/jeux.model');
const Galerie = require('../models/galerie.model');
const { pageAccueilSelonRole } = require('../utils/redirection');

const router = express.Router();

// Les visiteurs peuvent garder une copie 1 minute : le site reste rapide, une modification apparaît vite
router.use((req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60');
  next();
});

// Champs de l'événement affichés sur le site (modifie_par, etc. ne sortent jamais)
const CHAMPS_PUBLICS = [
  'nom', 'edition', 'annee', 'slogan', 'devise', 'presentation', 'description_courte', 'date_evenement', 'lieu',
  'telephone', 'whatsapp', 'email', 'adresse', 'horaires',
  'carte_url', 'lien_itineraire', 'facebook', 'instagram', 'tiktok',
  'histoire', 'mission', 'vision', 'engagement', 'image_apropos', 'chiffres'
];

router.get('/evenement', async (req, res, next) => {
  try {
    const evenement = await Evenement.lire();
    const reponse = {};
    CHAMPS_PUBLICS.forEach((champ) => { reponse[champ] = evenement[champ] ?? null; });
    // « 3e édition » : prêt à afficher
    reponse.edition_libelle = evenement.edition ? `${evenement.edition}${evenement.edition === 1 ? 're' : 'e'} édition` : null;
    res.json(reponse);
  } catch (err) {
    next(err);
  }
});

const limiteDe = (req) => Number.parseInt(req.query.limite, 10) || undefined;

router.get('/annonces', async (req, res, next) => {
  try {
    res.json(await Contenus.listerPublic('annonces', { limite: limiteDe(req) }));
  } catch (err) {
    next(err);
  }
});

// ?phase=ouvert | a-venir | clos ; ?limite=3
router.get('/jeux', async (req, res, next) => {
  try {
    res.json(await Jeux.listerPublic({ phase: req.query.phase, limite: limiteDe(req) }));
  } catch (err) {
    next(err);
  }
});

router.get('/jeux/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const jeu = Number.isInteger(id) && id > 0 ? await Jeux.trouverPublic(id) : null;
    if (!jeu) return res.status(404).json({ error: 'Jeu introuvable' });
    res.json(jeu);
  } catch (err) {
    next(err);
  }
});

// Photos des éditions passées, regroupées par édition
router.get('/galerie', async (req, res, next) => {
  try {
    res.json(await Galerie.listerParEdition());
  } catch (err) {
    next(err);
  }
});

// État de connexion pour le menu (« Se connecter » ou « Mon espace ») — toujours 200, jamais en cache
router.get('/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.json({ connecte: false });
  res.json({ connecte: true, accueil: pageAccueilSelonRole(req.user) });
});

module.exports = router;
