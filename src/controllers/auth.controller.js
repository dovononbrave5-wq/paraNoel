const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const Inscription = require('../models/inscription.model');
const { sendVerificationEmail } = require('../config/mailer');
const { journaliser } = require('../utils/journal');
const { pageAccueilSelonRole } = require('../utils/redirection');

const SALT_ROUNDS = 12;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;        // 24 h
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;    // « Se souvenir de moi » : 30 jours
const TOKEN_REGEX = /^[a-f0-9]{64}$/;            // 32 octets en hexadécimal

// --- Utilitaires ---
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cleanEmail = (value) => String(value || '').trim().toLowerCase();

// Crée un jeton, stocke son hash, envoie le lien par e-mail (peut lancer une erreur)
async function issueVerificationEmail(user) {
  const token = crypto.randomBytes(32).toString('hex'); // valeur envoyée à l'utilisateur
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await User.saveVerificationToken(user.id, sha256(token), expiresAt); // seul le hash est stocké
  await sendVerificationEmail(user.email, lienVerification(token));
}

const lienVerification = (token) => `${process.env.BASE_URL}/auth/verify-email?token=${token}`;

// --- Inscription ---
// Le compte n'est PAS créé ici : la demande attend dans « inscriptions_en_attente »
// et le compte n'entre dans « users » qu'au clic sur le lien de confirmation.
async function register(req, res, next) {
  try {
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail et mot de passe requis' });
    }

    const existant = await User.findByEmail(email);
    if (existant && (existant.is_verified || existant.google_id)) {
      return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
    }
    // Ancien compte jamais confirmé : on le retire, la nouvelle demande le remplace
    if (existant) await User.deleteIfUnverified(existant.id);

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const token = crypto.randomBytes(32).toString('hex');
    await Inscription.enregistrer(email, passwordHash, sha256(token), new Date(Date.now() + TOKEN_TTL_MS));

    try {
      await sendVerificationEmail(email, lienVerification(token));
    } catch (mailErr) {
      // Sans e-mail de confirmation, rien n'est gardé : l'adresse n'entre pas dans la base
      await Inscription.supprimer(email);
      console.error('Échec de l\'envoi de l\'e-mail de vérification :', mailErr.message);
      return res.status(502).json({
        error: 'Nous n\'avons pas pu envoyer l\'e-mail de confirmation. Ton compte n\'a pas été créé : vérifie ton adresse ou réessaie dans quelques minutes.',
        code: 'EMAIL_SEND_FAILED'
      });
    }

    res.status(201).json({
      message: 'Vérifiez votre boîte mail : votre compte sera créé dès que vous aurez cliqué sur le lien de confirmation.'
    });
  } catch (err) {
    next(err);
  }
}

// --- Vérification de l'e-mail : c'est ici que le compte est créé ---
async function verifyEmail(req, res, next) {
  try {
    const token = req.query.token;

    // Format attendu : 64 caractères hexadécimaux (rejette tableaux, objets, valeurs absurdes)
    if (typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
      return res.redirect('/login?verify=invalid');
    }

    const attente = await Inscription.trouverParJeton(sha256(token));
    if (attente) {
      if (!(await User.findByEmail(attente.email))) {
        try {
          const id = await User.createVerifiedUser(attente.email, attente.password_hash);
          await journaliser(req, 'inscription', 'Inscription par e-mail (adresse confirmée)', { id, email: attente.email });
        } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY') throw err; // double clic sur le lien : le compte existe déjà
        }
      }
      await Inscription.supprimer(attente.email);
      return res.redirect('/login?verified=1');
    }

    // Anciens comptes créés avant les inscriptions en attente
    const record = await User.findValidToken(sha256(token));
    if (!record) return res.redirect('/login?verify=invalid');
    await User.markVerified(record.user_id);
    await User.deleteTokensForUser(record.user_id); // jeton à usage unique
    res.redirect('/login?verified=1');
  } catch (err) {
    next(err);
  }
}

// --- Renvoi du lien ---
async function resendVerification(req, res, next) {
  try {
    const email = cleanEmail(req.body?.email);
    try {
      if (email && await Inscription.trouverParEmail(email)) {
        const token = crypto.randomBytes(32).toString('hex');
        await Inscription.renouvelerJeton(email, sha256(token), new Date(Date.now() + TOKEN_TTL_MS));
        await sendVerificationEmail(email, lienVerification(token));
      } else {
        const user = email ? await User.findByEmail(email) : null;
        if (user && !user.is_verified) await issueVerificationEmail(user);
      }
    } catch (mailErr) {
      // On journalise, mais la réponse reste identique : elle ne révèle pas quels e-mails existent
      console.error('Échec du renvoi de l\'e-mail de vérification :', mailErr.message);
    }

    res.json({ message: 'Si une inscription non confirmée existe pour cet e-mail, un lien vient d\'être envoyé.' });
  } catch (err) {
    next(err);
  }
}

// --- Connexion ---
async function login(req, res, next) {
  try {
    const email = cleanEmail(req.body?.email);
    const password = req.body?.password;
    const remember = req.body?.remember === true || req.body?.remember === 'true';
    const GENERIC_ERROR = 'E-mail ou mot de passe incorrect';

    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'E-mail et mot de passe requis' });
    }

    const user = await User.findByEmail(email);
    // Inscription pas encore confirmée : le compte n'existe pas encore
    if (!user) {
      const attente = await Inscription.trouverParEmail(email);
      if (attente && await bcrypt.compare(password, attente.password_hash)) {
        return res.status(403).json({
          error: 'Veuillez d\'abord confirmer votre adresse e-mail.',
          code: 'EMAIL_NOT_VERIFIED'
        });
      }
    }
    // Compte inexistant ou compte social sans mot de passe : même message générique
    if (!user || !user.password_hash) {
      await journaliser(req, 'connexion-echec', 'Compte inconnu ou sans mot de passe', { email });
      return res.status(401).json({ error: GENERIC_ERROR });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await journaliser(req, 'connexion-echec', 'Mot de passe incorrect', user);
      return res.status(401).json({ error: GENERIC_ERROR });
    }

    // Vérifié après le mot de passe : on ne révèle rien sur un compte sans le bon mot de passe
    if (user.statut === 'suspendu') {
      await journaliser(req, 'connexion-echec', 'Compte suspendu', user);
      return res.status(403).json({ error: 'Ce compte est suspendu. Contactez l\'organisation.' });
    }
    if (!user.is_verified) {
      return res.status(403).json({
        error: 'Veuillez d\'abord confirmer votre adresse e-mail.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    // Crée la session (même mécanisme que Google) — un seul appel à req.login
    req.login(user, async (err) => {
      if (err) return next(err);
      if (remember) req.session.cookie.maxAge = REMEMBER_MS; // sinon : cookie effacé à la fermeture du navigateur

      try {
        await User.updateLastLogin(user.id);
      } catch (e) {
        console.error('Erreur derniere_connexion :', e.message);
      }
      await journaliser(req, 'connexion', 'Connexion par e-mail', user);

      res.json({ message: 'Connecté', redirect: pageAccueilSelonRole(user) });
    });
  } catch (err) {
    next(err);
  }
}

// --- Déconnexion ---
function logout(req, res, next) {
  const user = req.user;
  req.logout(async (err) => {
    if (err) return next(err);
    if (user) await journaliser(req, 'deconnexion', null, user);
    const finish = () => {
      res.clearCookie('connect.sid');
      res.json({ message: 'Déconnecté', redirect: '/login' });
    };
    if (req.session) req.session.destroy(finish);
    else finish();
  });
}

module.exports = { register, verifyEmail, resendVerification, login, logout };
