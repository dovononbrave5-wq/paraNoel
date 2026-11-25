// Envoi d'images avec multer (illustration d'un jeu, photo « À propos »)
// Dossier : src/public/uploads/images (public). Nom aléatoire, type et contenu vérifiés.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const Stockage = require('../services/stockage');

const DOSSIER_IMAGES = path.join(__dirname, '..', 'public', 'uploads', 'images');
fs.mkdirSync(DOSSIER_IMAGES, { recursive: true });
// Formulaires PDF des jeux : dossier PRIVÉ (hors de public/), envoyés seulement en pièce jointe du reçu
const DOSSIER_FORMULAIRES = path.join(__dirname, '..', '..', 'prive', 'formulaires');
fs.mkdirSync(DOSSIER_FORMULAIRES, { recursive: true });
const TAILLE_MAX_PDF = 8 * 1024 * 1024; // 8 Mo (limite des pièces jointes des e-mails)
// Photos des réponses des joueurs : dossier PRIVÉ, visibles seulement par le joueur et l'administration
const DOSSIER_REPONSES = path.join(__dirname, '..', '..', 'prive', 'reponses');
fs.mkdirSync(DOSSIER_REPONSES, { recursive: true });
const MAX_PHOTOS_REPONSES = 10;

const TYPES_IMAGES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const TYPE_SVG = { 'image/svg+xml': '.svg' };

// Erreur lisible par le gestionnaire d'erreurs de app.js (status 400 + champ concerné)
function erreurFichier(champ, message) {
  const err = new Error(message);
  err.status = 400;
  err.champ = champ;
  return err;
}

// Nom aléatoire : le nom choisi par le visiteur n'est jamais utilisé (ni « ../ », ni écrasement)
const nomAleatoire = (extension) => `${crypto.randomBytes(16).toString('hex')}${extension}`;

function stockage(dossier, types) {
  return multer.diskStorage({
    destination: dossier,
    filename: (req, file, cb) => cb(null, nomAleatoire(types[file.mimetype]))
  });
}

// --- Vérification du contenu réel du fichier (le type annoncé par le navigateur peut mentir) ---
function debutDuFichier(chemin, taille = 512) {
  const fd = fs.openSync(chemin, 'r');
  try {
    const tampon = Buffer.alloc(taille);
    const lus = fs.readSync(fd, tampon, 0, taille, 0);
    return tampon.subarray(0, lus);
  } finally {
    fs.closeSync(fd);
  }
}

function contenuImageValide(fichier) {
  const debut = debutDuFichier(fichier.path);
  switch (fichier.mimetype) {
    case 'image/jpeg': return debut[0] === 0xff && debut[1] === 0xd8 && debut[2] === 0xff;
    case 'image/png': return debut.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp': return debut.toString('ascii', 0, 4) === 'RIFF' && debut.toString('ascii', 8, 12) === 'WEBP';
    case 'image/svg+xml': {
      // Un SVG peut contenir du JavaScript : on refuse scripts, gestionnaires « on… » et liens javascript:
      const texte = fs.readFileSync(fichier.path, 'utf8');
      return /<svg[\s>]/i.test(texte) && !/<script|\son\w+\s*=|javascript:|<foreignObject|<iframe/i.test(texte);
    }
    default: return false;
  }
}

// Suppression immédiate (fichiers de quelques Mo au plus) ; aucune erreur si le fichier n'existe plus
function supprimerFichier(chemin) {
  if (!chemin) return;
  try { fs.rmSync(chemin, { force: true }); } catch (err) { console.error('Suppression impossible :', err.message); }
  // Fichier déjà copié dans Cloudflare R2 : on le retire aussi
  if (Stockage.r2Actif()) {
    const categorie = Object.keys(Stockage.DOSSIERS).find((c) => path.dirname(path.resolve(chemin)) === path.resolve(Stockage.DOSSIERS[c]));
    if (categorie) Stockage.supprimer(categorie, path.basename(chemin));
  }
}

// Copie les fichiers validés dans R2 (en mode R2) ; en cas d'échec, tout est annulé
async function deposerTous(liste) {
  try {
    await Promise.all(liste.map(([categorie, f]) => Stockage.deposer(categorie, f.filename, f.path)));
  } catch (err) {
    liste.forEach(([, f]) => supprimerFichier(f.path));
    console.error(err.message);
    throw Object.assign(new Error('Le fichier n\'a pas pu être enregistré pour le moment. Réessayez dans quelques minutes.'), { status: 502 });
  }
}

/**
 * Middleware d'envoi d'une image facultative.
 * champ : nom du champ du formulaire (image, photo, logo, image_apropos) ou null (aucun fichier attendu)
 * Après le passage : req.file.cheminPublic = « /uploads/images/xxxx.webp »
 */
function image(champ, { svg = false } = {}) {
  const types = svg ? { ...TYPES_IMAGES, ...TYPE_SVG } : TYPES_IMAGES;
  const envoi = multer({
    storage: stockage(DOSSIER_IMAGES, types),
    limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 40, fieldSize: 20 * 1024 },
    fileFilter: (req, file, cb) => {
      if (types[file.mimetype]) return cb(null, true);
      cb(erreurFichier(file.fieldname, svg
        ? 'Image refusée : formats acceptés JPG, PNG, WebP ou SVG'
        : 'Image refusée : formats acceptés JPG, PNG ou WebP'));
    }
  });
  const middleware = champ ? envoi.single(champ) : envoi.none();

  return (req, res, next) => middleware(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return next();
    if (!contenuImageValide(req.file)) {
      supprimerFichier(req.file.path);
      return next(erreurFichier(champ, "Le fichier envoyé n'est pas une image valide"));
    }
    req.file.cheminPublic = `/uploads/images/${req.file.filename}`;
    deposerTous([['images', req.file]]).then(() => next(), next);
  });
}

/**
 * Plusieurs images d'un coup (galerie). Après le passage : req.images = ['/uploads/images/…', …]
 */
function images(champ, maximum = 20) {
  const envoi = multer({
    storage: stockage(DOSSIER_IMAGES, TYPES_IMAGES),
    limits: { fileSize: 5 * 1024 * 1024, files: maximum, fields: 10, fieldSize: 2 * 1024 },
    fileFilter: (req, file, cb) => {
      if (TYPES_IMAGES[file.mimetype]) return cb(null, true);
      cb(erreurFichier(champ, `« ${file.originalname} » refusée : formats acceptés JPG, PNG ou WebP`));
    }
  }).array(champ, maximum);

  return (req, res, next) => envoi(req, res, (err) => {
    const fichiers = req.files || [];
    if (err) {
      fichiers.forEach((f) => supprimerFichier(f.path));
      if (err.code === 'LIMIT_FILE_COUNT') return next(erreurFichier(champ, `${maximum} photos au maximum par envoi`));
      if (err.code === 'LIMIT_FILE_SIZE') return next(erreurFichier(champ, 'Une photo dépasse 5 Mo'));
      return next(err);
    }
    const invalide = fichiers.find((f) => !contenuImageValide(f));
    if (invalide) {
      fichiers.forEach((f) => supprimerFichier(f.path));
      return next(erreurFichier(champ, `« ${invalide.originalname} » n'est pas une image valide`));
    }
    req.images = fichiers.map((f) => `/uploads/images/${f.filename}`);
    deposerTous(fichiers.map((f) => ['images', f])).then(() => next(), next);
  });
}

// Supprime une ancienne image publique (« /uploads/images/xxx.jpg ») quand elle est remplacée
function supprimerImagePublique(cheminPublic) {
  if (typeof cheminPublic !== 'string' || !/^\/uploads\/images\/[a-f0-9]{32}\.(jpg|png|webp|svg)$/.test(cheminPublic)) return;
  supprimerFichier(path.join(DOSSIER_IMAGES, path.basename(cheminPublic)));
}

/**
 * Formulaire d'un jeu : illustration (champ « image ») + formulaire PDF (champ « formulaire »), tous deux facultatifs.
 * Après le passage : req.file = l'image (avec cheminPublic) ; req.pdf = { fichier, nom } pour le PDF.
 */
function imageEtPdf() {
  const envoi = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, file.fieldname === 'formulaire' ? DOSSIER_FORMULAIRES : DOSSIER_IMAGES),
      filename: (req, file, cb) => cb(null, nomAleatoire(file.fieldname === 'formulaire' ? '.pdf' : TYPES_IMAGES[file.mimetype]))
    }),
    limits: { fileSize: TAILLE_MAX_PDF, files: 2, fields: 40, fieldSize: 20 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.fieldname === 'image' && TYPES_IMAGES[file.mimetype]) return cb(null, true);
      if (file.fieldname === 'formulaire' && file.mimetype === 'application/pdf') return cb(null, true);
      cb(erreurFichier(file.fieldname, file.fieldname === 'formulaire'
        ? 'Formulaire refusé : seul le format PDF est accepté'
        : 'Image refusée : formats acceptés JPG, PNG ou WebP'));
    }
  }).fields([{ name: 'image', maxCount: 1 }, { name: 'formulaire', maxCount: 1 }]);

  return (req, res, next) => envoi(req, res, (err) => {
    const image = req.files?.image?.[0];
    const pdf = req.files?.formulaire?.[0];
    const toutSupprimer = () => { supprimerFichier(image?.path); supprimerFichier(pdf?.path); };
    if (err) { toutSupprimer(); return next(err); }

    if (image) {
      if (image.size > 3 * 1024 * 1024) { toutSupprimer(); return next(erreurFichier('image', 'Image trop volumineuse (3 Mo maximum)')); }
      if (!contenuImageValide(image)) { toutSupprimer(); return next(erreurFichier('image', "Le fichier envoyé n'est pas une image valide")); }
      image.cheminPublic = `/uploads/images/${image.filename}`;
      req.file = image;
    }
    if (pdf) {
      if (debutDuFichier(pdf.path, 5).toString('ascii') !== '%PDF-') {
        toutSupprimer();
        return next(erreurFichier('formulaire', "Le fichier envoyé n'est pas un PDF valide"));
      }
      // Nom affiché dans l'e-mail : nettoyé (lettres, chiffres, espaces, tirets), toujours en .pdf
      const nom = Buffer.from(pdf.originalname, 'latin1').toString('utf8')
        .replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N} _.'’-]/gu, '').trim().slice(0, 100) || 'formulaire';
      req.pdf = { fichier: pdf.filename, nom: `${nom}.pdf`, chemin: pdf.path };
    }
    const depots = [];
    if (image) depots.push(['images', image]);
    if (pdf) depots.push(['formulaires', pdf]);
    deposerTous(depots).then(() => next(), next);
  });
}

/**
 * Soumission d'un joueur : textes des cases (reponse_1, reponse_2…) + jusqu'à 10 photos (champ « photos »).
 * Après le passage : req.photos = ['xxxx.jpg', …] (noms des fichiers dans le dossier privé)
 */
function photosReponses() {
  const envoi = multer({
    storage: stockage(DOSSIER_REPONSES, TYPES_IMAGES),
    limits: { fileSize: 8 * 1024 * 1024, files: MAX_PHOTOS_REPONSES, fields: 120, fieldSize: 4 * 1024 },
    fileFilter: (req, file, cb) => {
      if (TYPES_IMAGES[file.mimetype]) return cb(null, true);
      cb(erreurFichier('photos', `« ${file.originalname} » refusée : envoyez des photos JPG, PNG ou WebP`));
    }
  }).array('photos', MAX_PHOTOS_REPONSES);

  return (req, res, next) => envoi(req, res, (err) => {
    const fichiers = req.files || [];
    const toutSupprimer = () => fichiers.forEach((f) => supprimerFichier(f.path));
    if (err) {
      toutSupprimer();
      if (err.code === 'LIMIT_FILE_COUNT') return next(erreurFichier('photos', `${MAX_PHOTOS_REPONSES} photos au maximum`));
      if (err.code === 'LIMIT_FILE_SIZE') return next(erreurFichier('photos', 'Une photo dépasse 8 Mo : réduisez sa taille et réessayez'));
      if (err.code === 'LIMIT_FIELD_VALUE') return next(erreurFichier('reponses', 'Une réponse est trop longue (1 000 caractères maximum)'));
      return next(err);
    }
    const invalide = fichiers.find((f) => !contenuImageValide(f));
    if (invalide) {
      toutSupprimer();
      return next(erreurFichier('photos', `« ${invalide.originalname} » n'est pas une image valide`));
    }
    req.photos = fichiers.map((f) => f.filename);
    deposerTous(fichiers.map((f) => ['reponses', f])).then(() => next(), next);
  });
}

function cheminPhotoReponse(fichier) {
  if (typeof fichier !== 'string' || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(fichier)) return null;
  return path.join(DOSSIER_REPONSES, fichier);
}
const supprimerPhotoReponse = (fichier) => supprimerFichier(cheminPhotoReponse(fichier));

// Chemin d'un formulaire PDF à partir du nom enregistré en base (refuse tout nom inattendu)
function cheminFormulaire(fichier) {
  if (typeof fichier !== 'string' || !/^[a-f0-9]{32}\.pdf$/.test(fichier)) return null;
  return path.join(DOSSIER_FORMULAIRES, fichier);
}
const supprimerFormulaire = (fichier) => supprimerFichier(cheminFormulaire(fichier));

module.exports = {
  image, images, imageEtPdf, photosReponses, cheminPhotoReponse, supprimerPhotoReponse, MAX_PHOTOS_REPONSES, supprimerFichier, supprimerImagePublique, cheminFormulaire, supprimerFormulaire,
  DOSSIER_IMAGES, DOSSIER_FORMULAIRES
};
