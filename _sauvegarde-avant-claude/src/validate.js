const { body, validationResult } = require('express-validator');

// E-mail : espaces retirés et minuscules (volontairement sans normalizeEmail, qui supprime
// les points des adresses Gmail et ne correspondrait plus à l'e-mail renvoyé par Google)
const emailRule = () =>
  body('email')
    .isString().withMessage('Adresse e-mail invalide').bail()
    .trim()
    .toLowerCase()
    .isEmail().withMessage('Adresse e-mail invalide')
    .isLength({ max: 254 }).withMessage('Adresse e-mail trop longue');

// Règles pour l'inscription (identiques à celles de inscription.js côté navigateur)
const registerRules = [
  emailRule(),

  body('password')
    .isString().withMessage('Mot de passe invalide').bail()
    .isLength({ min: 8, max: 72 }).withMessage('Le mot de passe doit contenir entre 8 et 72 caractères')
    .matches(/[A-Z]/).withMessage('Le mot de passe doit contenir une majuscule')
    .matches(/[a-z]/).withMessage('Le mot de passe doit contenir une minuscule')
    .matches(/\d/).withMessage('Le mot de passe doit contenir un chiffre')
    .matches(/[^A-Za-z0-9\s]/).withMessage('Le mot de passe doit contenir un caractère spécial'),

  body('confirmPassword')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Les mots de passe ne correspondent pas')
];

// Règles pour la connexion (on vérifie juste la présence des champs)
const loginRules = [
  emailRule(),
  body('password')
    .isString().withMessage('Mot de passe requis').bail()
    .notEmpty().withMessage('Mot de passe requis')
    .isLength({ max: 128 }).withMessage('Mot de passe invalide')
];

// --- Outils communs aux formulaires du site ---
const { LIBELLES } = require('../utils/libelles');
const { supprimerFichier } = require('./upload');

const TELEPHONE = /^\+?[0-9 .()-]{8,20}$/;
const URL_WEB = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

// Texte facultatif : espaces retirés, longueur maximale
const texteFacultatif = (champ, max, libelle) =>
  body(champ).optional({ values: 'falsy' })
    .isString().withMessage(`${libelle} : valeur invalide`).bail()
    .trim()
    .isLength({ max }).withMessage(`${libelle} : ${max} caractères maximum`);

// Texte obligatoire
const texteObligatoire = (champ, max, libelle, min = 1) =>
  body(champ)
    .isString().withMessage(`${libelle} : champ obligatoire`).bail()
    .trim()
    .isLength({ min }).withMessage(min > 1 ? `${libelle} : ${min} caractères minimum` : `${libelle} : champ obligatoire`).bail()
    .isLength({ max }).withMessage(`${libelle} : ${max} caractères maximum`);

const choix = (champ, liste, libelle, { obligatoire = true } = {}) => {
  const regle = body(champ);
  return (obligatoire ? regle : regle.optional({ values: 'falsy' }))
    .isIn(Object.keys(liste)).withMessage(`${libelle} : choisissez une option dans la liste`);
};

// La case de consentement envoie « on » (formulaire) ou true (JSON)
const consentement = () =>
  body('consentement')
    .custom((v) => v === true || ['on', 'true', '1'].includes(String(v).toLowerCase()))
    .withMessage('Merci de cocher la case de consentement');

// --- Formulaire de contact (POST /api/contact) ---
const contactRules = [
  texteObligatoire('nom', 100, 'Nom', 2),
  emailRule(),
  texteFacultatif('telephone', 20, 'Téléphone')
    .matches(TELEPHONE).withMessage('Téléphone : numéro invalide'),
  choix('objet', LIBELLES.objet, 'Type de projet'),
  texteObligatoire('message', 2000, 'Message', 10),
  consentement()
];

// --- Nommer un administrateur (POST /api/admin/administrateurs) ---
const nommerAdminRules = [emailRule()];

// --- Informations de l'événement (PUT /api/admin/evenement) ---
const urlFacultative = (champ, libelle, motif = URL_WEB, message = `${libelle} : adresse web invalide (https://…)`) =>
  body(champ).optional({ values: 'falsy' })
    .isString().bail().trim()
    .isLength({ max: 1000 }).withMessage(`${libelle} : adresse trop longue`).bail()
    .matches(motif).withMessage(message);

const dateHeure = (champ, libelle) =>
  body(champ).optional({ values: 'falsy' })
    .isString().bail().trim()
    .matches(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/).withMessage(`${libelle} : date et heure invalides`)
    .customSanitizer((v) => `${v.replace('T', ' ').slice(0, 16)}:00`);

const evenementRules = [
  texteObligatoire('nom', 120, "Nom de l'événement"),
  body('edition').isInt({ min: 1, max: 99 }).withMessage('Édition : nombre entre 1 et 99').toInt(),
  body('annee').optional({ values: 'falsy' }).isInt({ min: 2000, max: 2100 }).withMessage('Année invalide').toInt(),
  texteFacultatif('slogan', 150, 'Slogan'),
  texteFacultatif('devise', 100, 'Devise'),
  texteFacultatif('presentation', 400, 'Présentation'),
  texteFacultatif('description_courte', 250, 'Description courte'),
  dateHeure('date_evenement', "Date de l'événement"),
  texteFacultatif('lieu', 200, 'Lieu'),
  texteFacultatif('telephone', 20, 'Téléphone').matches(TELEPHONE).withMessage('Téléphone : numéro invalide'),
  texteFacultatif('whatsapp', 20, 'WhatsApp').matches(TELEPHONE).withMessage('WhatsApp : numéro invalide'),
  body('email').optional({ values: 'falsy' })
    .isString().bail().trim().toLowerCase()
    .isEmail().withMessage('E-mail de contact invalide'),
  texteFacultatif('adresse', 200, 'Adresse'),
  texteFacultatif('horaires', 300, 'Horaires'),
  // La politique de sécurité (Helmet) n'autorise que les cartes Google intégrées
  urlFacultative('carte_url', 'Carte', /^https:\/\/www\.google\.com\/maps\/embed\?/i,
    'Carte : collez l\'adresse « https://www.google.com/maps/embed?pb=… » donnée par Google Maps'),
  urlFacultative('lien_itineraire', 'Itinéraire'),
  urlFacultative('facebook', 'Facebook'),
  urlFacultative('instagram', 'Instagram'),
  urlFacultative('tiktok', 'TikTok'),
  texteFacultatif('histoire', 3000, 'Notre histoire'),
  texteFacultatif('mission', 500, 'Notre mission'),
  texteFacultatif('vision', 500, 'Notre ambition'),
  texteFacultatif('engagement', 500, 'Notre promesse'),
  // Chiffres clés : texte JSON [{ valeur, suffixe, libelle }] (4 au maximum), transformé en tableau
  body('chiffres').optional({ values: 'falsy' }).custom((texte, { req }) => {
    let liste;
    try { liste = JSON.parse(texte); } catch { throw new Error('Chiffres clés : format invalide'); }
    if (!Array.isArray(liste) || liste.length > 4) throw new Error('Chiffres clés : 4 au maximum');
    req.chiffres = liste.map((c, i) => {
      const valeur = Number(c?.valeur);
      const libelle = String(c?.libelle ?? '').trim();
      const suffixe = String(c?.suffixe ?? '').trim();
      if (!Number.isInteger(valeur) || valeur < 0 || valeur > 1000000) throw new Error(`Chiffre ${i + 1} : nombre entier entre 0 et 1 000 000`);
      if (!libelle || libelle.length > 60) throw new Error(`Chiffre ${i + 1} : libellé obligatoire (60 caractères maximum)`);
      if (suffixe.length > 3) throw new Error(`Chiffre ${i + 1} : suffixe de 3 caractères maximum`);
      return { valeur, suffixe, libelle };
    });
    return true;
  })
];

// Lit le résultat de la validation et bloque s'il y a des erreurs.
// Si un fichier vient d'être envoyé (CV, image), il est supprimé : la demande est refusée.
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) supprimerFichier(req.file.path);
    return res.status(400).json({
      errors: errors.array({ onlyFirstError: true }).map(e => ({ champ: e.path, message: e.msg }))
    });
  }
  next();
}

module.exports = {
  registerRules, loginRules, contactRules, nommerAdminRules, evenementRules, handleValidation
};