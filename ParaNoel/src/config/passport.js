const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const AppleStrategy = require('passport-apple');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

// --- 1. Session : on ne garde que l'id dans le cookie ---
passport.serializeUser((user, done) => done(null, user.id));

// Relu à chaque requête : un compte supprimé ou suspendu est déconnecté immédiatement
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    if (!user || user.statut === 'suspendu') return done(null, false);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Erreur reconnue par le callback OAuth (redirection vers /login?error=suspendu)
function compteSuspendu() {
  const err = new Error('Compte suspendu');
  err.code = 'COMPTE_SUSPENDU';
  return err;
}

// --- Logique commune Google/Apple : trouver, lier ou créer ---
async function findOrCreateSocialUser(provider, providerId, email, emailVerified) {
  // 1. Ce compte social est déjà connu : on le connecte
  const byProvider = provider === 'google'
    ? await User.findByGoogleId(providerId)
    : await User.findByAppleId(providerId);
  if (byProvider) {
    if (byProvider.statut === 'suspendu') throw compteSuspendu();
    return byProvider;
  }
  // 2. Un compte existe avec cet e-mail : on le lie, uniquement si le fournisseur
  //    garantit que l'e-mail est vérifié (sinon, risque de prise de contrôle de compte)
  if (email) {
    const byEmail = await User.findByEmail(email);
    if (byEmail) {
      if (byEmail.statut === 'suspendu') throw compteSuspendu();
      if (!emailVerified) throw new Error('E-mail non vérifié par le fournisseur');
      await User.linkProvider(byEmail.id, provider, providerId);
      return User.findById(byEmail.id);
    }
  }

  // 3. Nouveau compte
  if (!email) throw new Error('Aucun e-mail fourni par le fournisseur');
  const id = await User.createSocialUser(email, provider, providerId);
  const nouveau = await User.findById(id);
  nouveau.nouveau = true; // lu par le callback pour journaliser l'inscription
  return nouveau;
}

// --- 2. Google : activé seulement si les clés sont présentes ---
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BASE_URL}/auth/google/callback`
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      const verified = profile.emails?.[0]?.verified === true;
      const user = await findOrCreateSocialUser('google', profile.id, email, verified);
      done(null, user);
    } catch (err) {
      done(err);
    }
  }));
} else {
  console.warn('Google OAuth désactivé : GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants');
}

// --- 3. Apple : activé seulement si les clés sont présentes ---
if (process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY) {
  passport.use(new AppleStrategy({
    clientID: process.env.APPLE_CLIENT_ID,         // le Services ID
    teamID: process.env.APPLE_TEAM_ID,
    keyID: process.env.APPLE_KEY_ID,
    privateKeyString: process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // contenu du fichier .p8
    callbackURL: `${process.env.BASE_URL}/auth/apple/callback`,
    scope: ['name', 'email']
  }, async (accessToken, refreshToken, idToken, profile, done) => {
    try {
      // Les infos de l'utilisateur sont dans l'idToken (un JWT signé par Apple)
      const claims = jwt.decode(idToken);
      const email = claims.email?.toLowerCase();
      const verified = claims.email_verified === true || claims.email_verified === 'true';
      const user = await findOrCreateSocialUser('apple', claims.sub, email, verified);
      done(null, user);
    } catch (err) {
      done(err);
    }
  }));
} else {
  console.warn('Apple Sign In désactivé : variables APPLE_* manquantes');
}