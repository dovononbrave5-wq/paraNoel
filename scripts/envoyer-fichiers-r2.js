// Copie dans Cloudflare R2 les fichiers déjà présents sur le disque (galerie, illustrations,
// questionnaires PDF, photos des réponses), pour les retrouver sur le site en ligne.
// Usage :  npm run envoyer-fichiers-r2   (les variables R2_* doivent être remplies dans .env)
// Les fichiers locaux sont conservés : rien n'est supprimé.
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const Stockage = require('../src/services/stockage');

(async () => {
  if (!Stockage.r2Actif()) {
    console.error('✘ Remplissez R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY et R2_BUCKET dans .env');
    process.exitCode = 1;
    return;
  }
  let total = 0;
  let erreurs = 0;
  for (const [categorie, dossier] of Object.entries(Stockage.DOSSIERS)) {
    const fichiers = await fs.readdir(dossier).catch(() => []);
    for (const fichier of fichiers.filter((f) => /^[a-f0-9]{32}\.(jpg|png|webp|svg|pdf)$/.test(f))) {
      // deposer() supprime la copie envoyée : on envoie une copie temporaire pour garder l'original
      const temporaire = path.join(os.tmpdir(), fichier);
      try {
        await fs.copyFile(path.join(dossier, fichier), temporaire);
        await Stockage.deposer(categorie, fichier, temporaire);
        total++;
        console.log(`✔ ${categorie}/${fichier}`);
      } catch (err) {
        erreurs++;
        console.error(`✘ ${categorie}/${fichier} : ${err.message}`);
      }
    }
  }
  console.log(`\n${total} fichier(s) copiés dans R2${erreurs ? `, ${erreurs} en erreur` : ''}.`);
  if (erreurs) process.exitCode = 1;
})();
