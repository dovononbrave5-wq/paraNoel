require('dotenv').config();

// Échoue tout de suite, avec un message clair, si la configuration est incomplète
if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET manquant dans .env');
  process.exit(1);
}

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const multer = require('multer');
const passport = require('passport');

const db = require('./config/db');
require('./config/passport'); // connexion avec Google
const authRoutes = require('./routes/auth.routes');
const { router: pagesRoutes, adresseDuFichier } = require('./routes/pages.routes');
const publicRoutes = require('./routes/public.routes');
const contactRoutes = require('./routes/contact.routes');
const jeuxRoutes = require('./routes/jeux.routes');
const adminRoutes = require('./routes/admin.routes');
const membreRoutes = require('./routes/membre.routes');
const kkiapay = require('./services/kkiapay');
const mailer = require('./config/mailer');
const Stockage = require('./services/stockage');
const Inscription = require('./models/inscription.model');
const Jeux = require('./models/jeux.model');
const Galerie = require('./models/galerie.model');
const AccueilPhotos = require('./models/accueil-photos.model');

const PUBLIC_DIR = path.join(__dirname, 'public');
const page404 = (res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
const isProd = process.env.NODE_ENV === 'production';
const app = express();

// Derrière un hébergeur (proxy), nécessaire pour les cookies « secure » et le limiteur de tentatives
if (isProd) app.set('trust proxy', 1);

// Politique de sécurité : seuls nos fichiers, Google Fonts, la carte Google Maps
// et la fenêtre de paiement KKiaPay (Mobile Money) sont autorisés
const KKIAPAY = 'https://*.kkiapay.me';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", 'https://cdn.kkiapay.me'],
      frameSrc: ["'self'", 'https://www.google.com', KKIAPAY],
      connectSrc: ["'self'", KKIAPAY],
      imgSrc: ["'self'", 'data:', KKIAPAY],
      // En local (http://localhost), ne pas forcer le passage en https
      upgradeInsecureRequests: isProd ? [] : null
    }
  }
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Les pages passent par leurs adresses (/a-propos, /dashboard…) :
// /about.html est redirigé vers /a-propos, et /admin.html ne contourne pas requireRole
app.use((req, res, next) => {
  if (!/\.html$/i.test(req.path)) return next();
  const adresse = adresseDuFichier[path.basename(req.path).toLowerCase()];
  if (adresse) return res.redirect(301, adresse);
  return page404(res);
});

// Fichiers statiques (CSS, JS, images, images envoyées depuis l'administration)
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: isProd ? '1d' : 0 }));
// Images envoyées depuis l'administration quand elles sont stockées dans Cloudflare R2
app.get('/uploads/images/:fichier', (req, res) => Stockage.envoyer(res, 'images', req.params.fichier, { cache: 'public, max-age=86400' }));

// Sessions enregistrées dans MySQL (table « sessions », créée automatiquement) :
// elles survivent à un redémarrage du serveur, contrairement à la mémoire
const sessionStore = new MySQLStore({ clearExpired: true, checkExpirationInterval: 15 * 60 * 1000 }, db);

app.use(session({
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd }
}));

app.use(passport.initialize());
app.use(passport.session());

// --- Routes ---
app.use('/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', contactRoutes);
app.use('/api', jeuxRoutes);
app.use('/api', membreRoutes);
app.use('/', pagesRoutes);

// --- Gestion des erreurs (toujours après les routes) ---

// URL inconnue
app.use((req, res) => {
  if (req.originalUrl.startsWith('/auth/') || req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ error: 'Ressource introuvable' });
  }
  page404(res);
});

// Toutes les erreurs passées à next(err) arrivent ici
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Erreurs d'envoi de fichier (taille, type) : message pour le formulaire, avec le champ concerné
  if (err instanceof multer.MulterError || err.champ) {
    const messages = {
      LIMIT_FILE_SIZE: 'Fichier trop volumineux',
      LIMIT_UNEXPECTED_FILE: 'Fichier inattendu dans ce formulaire',
      LIMIT_FIELD_VALUE: 'Un des textes est trop long',
      LIMIT_FIELD_COUNT: 'Trop de champs dans le formulaire'
    };
    const message = messages[err.code] || err.message;
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: message,
      errors: [{ champ: err.field || err.champ || null, message }]
    });
  }

  let status = err.status || err.statusCode || 500;
  let message = status < 500 ? err.message : 'Erreur interne du serveur';

  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Requête invalide (JSON mal formé)';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Requête trop volumineuse';
  } else if (['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST',
              'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE'].includes(err.code)) {
    status = 503; // MySQL éteint, mauvais identifiants, base ou tables absentes
    message = 'Service temporairement indisponible';
  }

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);

  const body = { error: message };
  if (!isProd) body.detail = err.message; // jamais en production
  res.status(status).json(body);
});

// Filets de sécurité pour les erreurs hors requêtes
process.on('unhandledRejection', (reason) => {
  console.error('Promesse rejetée non gérée :', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Exception non gérée :', err);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Para'Noel lancé sur http://localhost:${PORT}`);
  db.verifierConnexion();
  Galerie.creerTable().catch((err) => console.error('Table de la galerie :', err.code || err.message));
  AccueilPhotos.creerTable().catch((err) => console.error('Table des photos de l\'accueil :', err.code || err.message));
  Jeux.initialiser().catch((err) => console.error('Mise à jour des tables jeux et participations :', err.code || err.message));
  Inscription.creerTable().catch((err) => console.error('Table des inscriptions en attente :', err.code || err.message));
  kkiapay.verifierConfiguration();
  mailer.verifierConfiguration();
  Stockage.verifierConfiguration();
});