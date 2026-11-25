// Envoi d'images avec multer (illustration d'un jeu, photo « À propos »)
// Dossier : src/public/uploads/images (public). Nom aléatoire, type et contenu vérifiés.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const DOSSIER_IMAGES = path.join(__dirname, '..', 'public', 'uploads', 'images');
fs.mkdirSync(DOSSIER_IMAGES, { recursive: true });

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
    next();
  });
}

// Supprime une ancienne image publique (« /uploads/images/xxx.jpg ») quand elle est remplacée
function supprimerImagePublique(cheminPublic) {
  if (typeof cheminPublic !== 'string' || !/^\/uploads\/images\/[a-f0-9]{32}\.(jpg|png|webp|svg)$/.test(cheminPublic)) return;
  supprimerFichier(path.join(DOSSIER_IMAGES, path.basename(cheminPublic)));
}

module.exports = { image, supprimerFichier, supprimerImagePublique, DOSSIER_IMAGES };
