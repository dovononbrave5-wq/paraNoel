// Stockage des fichiers envoyés (galerie, illustrations, questionnaires PDF, photos des réponses).
//  - En local (MAMP) : sur le disque, comme avant.
//  - En ligne : dans Cloudflare R2 dès que les variables R2_* sont remplies dans .env / Render.
// Aucune dépendance : les requêtes vers R2 (compatible S3) sont signées ici (AWS Signature V4).
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..', '..');
// Dossiers sur le disque pour chaque catégorie (identiques à ceux de middlewares/upload.js)
const DOSSIERS = {
  images: path.join(RACINE, 'src', 'public', 'uploads', 'images'),
  formulaires: path.join(RACINE, 'prive', 'formulaires'),
  reponses: path.join(RACINE, 'prive', 'reponses')
};
const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
const NOM_VALIDE = /^[a-f0-9]{32}\.(jpg|png|webp|svg|pdf)$/;

const r2Actif = () => Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
                             process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

/* ---------------------------------------------------------------------
   Requêtes signées vers R2
   --------------------------------------------------------------------- */
const sha256 = (donnees) => crypto.createHash('sha256').update(donnees).digest('hex');
const hmac = (cle, texte) => crypto.createHmac('sha256', cle).update(texte).digest();
const encoder = (cle) => cle.split('/').map(encodeURIComponent).join('/');

async function requeteR2(methode, cle, corps = null, enTetes = {}) {
  const hote = `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const chemin = `/${encodeURIComponent(process.env.R2_BUCKET)}/${encoder(cle)}`;
  const maintenant = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261125T224500Z
  const jour = maintenant.slice(0, 8);
  const empreinte = sha256(corps || '');

  const entetes = { host: hote, 'x-amz-content-sha256': empreinte, 'x-amz-date': maintenant, ...enTetes };
  const noms = Object.keys(entetes).map((n) => n.toLowerCase()).sort();
  const canonique = [
    methode, chemin, '',
    ...noms.map((n) => `${n}:${String(entetes[Object.keys(entetes).find((k) => k.toLowerCase() === n)]).trim()}`), '',
    noms.join(';'), empreinte
  ].join('\n');
  const portee = `${jour}/auto/s3/aws4_request`;
  const aSigner = ['AWS4-HMAC-SHA256', maintenant, portee, sha256(canonique)].join('\n');
  let cleSignature = hmac(`AWS4${process.env.R2_SECRET_ACCESS_KEY}`, jour);
  for (const morceau of ['auto', 's3', 'aws4_request']) cleSignature = hmac(cleSignature, morceau);
  const signature = crypto.createHmac('sha256', cleSignature).update(aSigner).digest('hex');

  const { host, ...autres } = entetes;
  return fetch(`https://${hote}${chemin}`, {
    method: methode,
    headers: {
      ...autres,
      Authorization: `AWS4-HMAC-SHA256 Credential=${process.env.R2_ACCESS_KEY_ID}/${portee}, SignedHeaders=${noms.join(';')}, Signature=${signature}`
    },
    body: corps || undefined,
    signal: AbortSignal.timeout(30000)
  });
}

async function verifierReponse(reponse, action) {
  if (reponse.ok) return;
  const texte = await reponse.text().catch(() => '');
  const code = /<Code>([^<]+)<\/Code>/.exec(texte)?.[1] || reponse.statusText;
  throw Object.assign(new Error(`R2 : ${action} impossible (${reponse.status} ${code})`), { status: reponse.status });
}

/* ---------------------------------------------------------------------
   Fonctions utilisées par le site
   --------------------------------------------------------------------- */
// Vérifie la catégorie et le nom (jamais de « ../ » ni de nom choisi par le visiteur)
function cleDe(categorie, fichier) {
  if (!DOSSIERS[categorie] || typeof fichier !== 'string' || !NOM_VALIDE.test(fichier)) return null;
  return `${categorie}/${fichier}`;
}

/**
 * Après l'envoi par multer (fichier temporaire sur le disque) : en mode R2, copie le fichier dans R2
 * puis supprime la copie locale. En mode disque, le fichier est déjà à sa place.
 */
async function deposer(categorie, fichier, cheminLocal) {
  if (!r2Actif()) return;
  const cle = cleDe(categorie, fichier);
  if (!cle) throw new Error('Nom de fichier invalide');
  const contenu = await fs.readFile(cheminLocal);
  const reponse = await requeteR2('PUT', cle, contenu, {
    'content-type': TYPES[path.extname(fichier)] || 'application/octet-stream',
    'content-length': String(contenu.length)
  });
  await verifierReponse(reponse, "l'envoi du fichier");
  await fs.rm(cheminLocal, { force: true }).catch(() => {});
}

// Copie un fichier du disque (ex. PDF d'exemple) vers le stockage, sous un nouveau nom aléatoire
async function importer(categorie, cheminSource) {
  const fichier = `${crypto.randomBytes(16).toString('hex')}${path.extname(cheminSource).toLowerCase()}`;
  const destination = path.join(DOSSIERS[categorie], fichier);
  await fs.mkdir(DOSSIERS[categorie], { recursive: true });
  await fs.copyFile(cheminSource, destination);
  await deposer(categorie, fichier, destination);
  return fichier;
}

// Contenu complet (Buffer) : pièce jointe des e-mails
async function lire(categorie, fichier) {
  const cle = cleDe(categorie, fichier);
  if (!cle) throw Object.assign(new Error('Fichier introuvable'), { status: 404 });
  if (!r2Actif()) return fs.readFile(path.join(DOSSIERS[categorie], fichier));
  const reponse = await requeteR2('GET', cle);
  await verifierReponse(reponse, 'la lecture du fichier');
  return Buffer.from(await reponse.arrayBuffer());
}

/**
 * Envoie un fichier au navigateur. options.telechargement : nom proposé pour l'enregistrer.
 * options.cache : en-tête Cache-Control. Répond 404 si le fichier n'existe pas.
 */
async function envoyer(res, categorie, fichier, { telechargement = null, cache = 'private, no-store' } = {}) {
  const cle = cleDe(categorie, fichier);
  if (!cle) return res.status(404).json({ error: 'Fichier introuvable' });
  res.set('Cache-Control', cache);
  res.set('Content-Type', TYPES[path.extname(fichier)] || 'application/octet-stream');
  res.set('X-Content-Type-Options', 'nosniff');
  if (telechargement) res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(telechargement)}`);

  if (!r2Actif()) {
    return res.sendFile(path.join(DOSSIERS[categorie], fichier), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Fichier introuvable' });
    });
  }
  try {
    const reponse = await requeteR2('GET', cle);
    if (reponse.status === 404) return res.status(404).json({ error: 'Fichier introuvable' });
    await verifierReponse(reponse, 'la lecture du fichier');
    res.send(Buffer.from(await reponse.arrayBuffer()));
  } catch (err) {
    console.error(err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Fichier momentanément indisponible' });
  }
}

// Suppression (sans erreur si le fichier n'existe plus)
async function supprimer(categorie, fichier) {
  const cle = cleDe(categorie, fichier);
  if (!cle) return;
  try {
    if (r2Actif()) await requeteR2('DELETE', cle);
    else await fs.rm(path.join(DOSSIERS[categorie], fichier), { force: true });
  } catch (err) {
    console.error(`Suppression de ${cle} impossible :`, err.message);
  }
}

// Message au démarrage
function verifierConfiguration() {
  console.log(r2Actif()
    ? `Fichiers stockés dans Cloudflare R2 (bucket « ${process.env.R2_BUCKET} »)`
    : 'Fichiers stockés sur le disque (ajoutez R2_* dans .env pour utiliser Cloudflare R2)');
}

module.exports = { r2Actif, deposer, importer, lire, envoyer, supprimer, verifierConfiguration, DOSSIERS };
