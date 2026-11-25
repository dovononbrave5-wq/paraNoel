const express = require('express');
const path = require('path');
const { requireAuth, redirectIfAuth } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/roles');

const router = express.Router();
const page = (name) => path.join(__dirname, '..', 'public', name);

// Adresses publiques du site → fichier HTML envoyé
const pagesPubliques = {
  '/': 'index.html',
  '/jeux': 'jeux.html',
  '/participer': 'participer.html',
  '/annonces': 'annonces.html',
  '/a-propos': 'about.html',
  '/contact': 'contact.html'
};

// Pages avec une protection : [middlewares, fichier]
const pagesProtegees = {
  '/login': [[redirectIfAuth], 'login.html'],
  '/register': [[redirectIfAuth], 'register.html'],
  '/dashboard': [[requireAuth], 'dashboard.html'],
  '/admin': [[requireRole('admin', 'super_admin')], 'admin.html']
};

Object.entries(pagesPubliques).forEach(([adresse, fichier]) => {
  router.get(adresse, (req, res) => res.sendFile(page(fichier)));
});

Object.entries(pagesProtegees).forEach(([adresse, [protections, fichier]]) => {
  router.get(adresse, ...protections, (req, res) => {
    res.set('Cache-Control', 'no-store'); // pas de copie en cache d'une page privée
    res.sendFile(page(fichier));
  });
});

// Inverse des deux tables : « about.html » → « /a-propos » (utilisé par app.js pour rediriger les anciens liens .html)
const adresseDuFichier = {};
Object.entries(pagesPubliques).forEach(([adresse, fichier]) => { adresseDuFichier[fichier] = adresse; });
Object.entries(pagesProtegees).forEach(([adresse, [, fichier]]) => { adresseDuFichier[fichier] = adresse; });

// --- Espace membre ---

// Infos de l'utilisateur connecté (sans données sensibles)
router.get('/api/me', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
});

module.exports = { router, adresseDuFichier, pagesPubliques };
