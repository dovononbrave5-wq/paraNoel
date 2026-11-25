// Remplit le site avec des textes d'exemple (accueil, à propos, contact, annonces, un jeu concours).
// Usage :  npm run remplir-contenu            → remplit seulement les champs VIDES (rien n'est écrasé)
//          npm run remplir-contenu -- --tout  → remplace aussi les textes de l'événement déjà saisis
// Tout reste modifiable ensuite dans l'administration.
require('dotenv').config();
const path = require('path');
const db = require('../src/config/db');
const Stockage = require('../src/services/stockage');

const TOUT = process.argv.includes('--tout');

const EVENEMENT = {
  nom: "Para'Noel",
  edition: 3,
  annee: 2026,
  slogan: 'La magie de Noël, en grand !',
  devise: 'Jouer · Partager · Célébrer',
  presentation: "Pour sa 3e édition, Para'Noel réunit familles, étudiants et passionnés autour d'une grande fête de Noël : jeux concours, animations, musique et remises de prix. Inscris-toi, tente ta chance en ligne et viens célébrer avec nous !",
  description_courte: "Para'Noel, la grande fête de Noël qui mêle jeux concours en ligne, défis en présentiel et moments de partage pour toute la famille.",
  date_evenement: '2026-12-20 15:00:00',
  lieu: 'Cotonou, Bénin',
  adresse: 'Esplanade du Palais des Congrès, Cotonou',
  horaires: 'Samedi 20 décembre 2026, de 15 h à 23 h. Accueil du public dès 14 h 30.',
  histoire: "Tout a commencé en 2024 avec une idée simple : offrir aux jeunes de Cotonou un Noël différent, où l'on gagne en s'amusant et en apprenant.\n\nLa 1re édition a rassemblé quelques centaines de participants autour d'un quiz de culture générale et d'un après-midi festif. Devant l'enthousiasme du public, la 2e édition a grandi : nouveaux jeux, plus de lots, et une finale en présentiel suivie par toute la salle.\n\nAujourd'hui, Para'Noel revient pour une 3e édition encore plus ambitieuse, avec des questionnaires en ligne ouverts à tous, un paiement simple par Mobile Money et une grande soirée de clôture pour célébrer les gagnants.",
  mission: 'Rendre la culture et le jeu accessibles à tous pendant les fêtes, en créant un événement joyeux, sûr et équitable où chacun peut tenter sa chance.',
  vision: "Faire de Para'Noel le rendez-vous incontournable des fêtes de fin d'année au Bénin, attendu chaque année par les familles et la jeunesse.",
  engagement: 'Des règles claires, une correction automatique et impartiale, des paiements sécurisés et des lots réellement remis aux gagnants.',
  telephone: '+229 01 00 00 00 00',
  whatsapp: '+229 01 00 00 00 00',
  email: 'contact@paranoel.bj'
};

const ANNONCES = [
  { type: 'actualite', titre: "Les inscriptions pour la 3e édition sont ouvertes !", lieu: 'En ligne',
    description: "Crée ton compte dès maintenant pour participer aux jeux concours de Para'Noel 2026. Le paiement se fait en quelques secondes par MTN MoMo, Moov Money ou Celtiis Cash." },
  { type: 'jeu', titre: 'Le Grand Quiz de Noël est en ligne', lieu: 'En ligne',
    description: "10 questions sur Noël, la culture générale et le Bénin. Achète le questionnaire, envoie tes réponses en ligne avant la clôture : les meilleurs seront invités à la finale en présentiel." },
  { type: 'programme', titre: 'Programme de la soirée du 20 décembre', lieu: 'Cotonou',
    description: "15 h : ouverture des portes et animations pour les enfants.\n17 h : finale en présentiel des jeux concours.\n20 h : concert et remise des prix.\n23 h : clôture et feu d'artifice." }
];

const JEU = {
  titre: 'Le Grand Quiz de Noël',
  description: "Teste tes connaissances sur Noël, la culture générale et le Bénin. Après l'achat, tu reçois le questionnaire PDF : envoie tes réponses dans les cases du site ou en photo avant la clôture. Les meilleurs sont invités à la finale en présentiel.",
  reglement: "Une seule participation par compte.\nLe questionnaire PDF est envoyé par e-mail après le paiement et reste téléchargeable sur le site.\nRéponses à envoyer avant la date de clôture : dans les cases du site, en photo, ou les deux.\nTu peux modifier tes réponses jusqu'à la clôture.\nL'organisation examine toutes les réponses et invite les meilleurs participants à la finale.",
  prix: 1000,
  nb_reponses: 10,
  rencontre_lieu: 'Esplanade du Palais des Congrès, Cotonou',
  rencontre_infos: "Présente-toi 30 minutes avant le début avec une pièce d'identité et l'e-mail de reçu de ton paiement."
};

// Questionnaire PDF d'exemple (scripts/exemple-questionnaire.pdf), copié dans le stockage
// des formulaires : dossier privé en local, ou Cloudflare R2 si les variables R2_* sont remplies
const PDF_EXEMPLE = path.join(__dirname, 'exemple-questionnaire.pdf');
const copierPdfExemple = () => Stockage.importer('formulaires', PDF_EXEMPLE);

const vide = (v) => v === null || v === undefined || String(v).trim() === '';

async function remplirEvenement() {
  const [[actuel]] = await db.execute('SELECT * FROM evenement WHERE id = 1');
  if (!actuel) {
    const colonnes = Object.keys(EVENEMENT);
    await db.execute(
      `INSERT INTO evenement (id, ${colonnes.join(', ')}) VALUES (1, ${colonnes.map(() => '?').join(', ')})`,
      Object.values(EVENEMENT)
    );
    return colonnes;
  }
  // Coordonnées (téléphone, WhatsApp, e-mail) : jamais remplacées si elles sont déjà saisies
  const PROTEGES = ['telephone', 'whatsapp', 'email'];
  const aRemplir = Object.keys(EVENEMENT).filter((c) => vide(actuel[c]) || (TOUT && !PROTEGES.includes(c)));
  if (aRemplir.length) {
    await db.execute(
      `UPDATE evenement SET ${aRemplir.map((c) => `${c} = ?`).join(', ')}, modifie_le = NOW() WHERE id = 1`,
      aRemplir.map((c) => EVENEMENT[c])
    );
  }
  return aRemplir;
}

async function remplirAnnonces() {
  const [[{ n }]] = await db.execute('SELECT COUNT(*) AS n FROM annonces');
  if (Number(n) > 0) return 0;
  for (const [i, a] of ANNONCES.entries()) {
    await db.execute(
      `INSERT INTO annonces (ordre, type, titre, lieu, description, date_publication, statut)
       VALUES (?, ?, ?, ?, ?, NOW() - INTERVAL ? DAY, 'publiee')`,
      [i, a.type, a.titre, a.lieu, a.description, i]
    );
  }
  return ANNONCES.length;
}

async function remplirJeu() {
  // Colonnes récentes (créées aussi au démarrage du serveur)
  await require('../src/models/jeux.model').initialiser();

  // Le jeu d'exemple existe déjà sans questionnaire PDF : on lui ajoute celui d'exemple
  const [[existant]] = await db.execute('SELECT id, formulaire_pdf FROM jeux WHERE titre = ?', [JEU.titre]);
  if (existant && !existant.formulaire_pdf) {
    await db.execute(
      'UPDATE jeux SET formulaire_pdf = ?, formulaire_nom = ?, nb_reponses = ?, description = ?, reglement = ? WHERE id = ?',
      [await copierPdfExemple(), 'Questionnaire - Le Grand Quiz de Noel.pdf', JEU.nb_reponses, JEU.description, JEU.reglement, existant.id]
    );
    return 'pdf-ajoute';
  }

  const [[{ n }]] = await db.execute('SELECT COUNT(*) AS n FROM jeux');
  if (Number(n) > 0) return false;
  await db.execute(
    `INSERT INTO jeux (titre, description, reglement, prix, date_ouverture, date_cloture, nb_reponses, formulaire_pdf, formulaire_nom,
                       statut, rencontre_date, rencontre_lieu, rencontre_infos, rencontre_publiee)
     VALUES (?, ?, ?, ?, NOW(), '2026-12-15 23:59:00', ?, ?, ?, 'publie', '2026-12-20 17:00:00', ?, ?, 0)`,
    [JEU.titre, JEU.description, JEU.reglement, JEU.prix, JEU.nb_reponses, await copierPdfExemple(), 'Questionnaire - Le Grand Quiz de Noel.pdf',
     JEU.rencontre_lieu, JEU.rencontre_infos]
  );
  return true;
}

(async () => {
  try {
    const champs = await remplirEvenement();
    console.log(champs.length ? `✔ Événement : ${champs.length} champ(s) rempli(s) (${champs.join(', ')})` : '• Événement : tous les champs étaient déjà remplis (utilisez --tout pour remplacer les textes)');
    const annonces = await remplirAnnonces();
    console.log(annonces ? `✔ Annonces : ${annonces} annonces publiées` : '• Annonces : il en existe déjà, rien ajouté');
    const jeu = await remplirJeu();
    console.log(jeu === 'pdf-ajoute' ? `✔ Jeu concours : questionnaire PDF d'exemple ajouté à « ${JEU.titre} »`
      : jeu ? `✔ Jeu concours : « ${JEU.titre} » publié avec son questionnaire PDF (${JEU.nb_reponses} cases de réponses)`
        : '• Jeu concours : il en existe déjà, rien ajouté');
    console.log('\nTerminé. Rechargez le site (Ctrl + F5) pour voir les textes.');
  } catch (err) {
    console.error('✘ Échec :', err.code || err.message, '- vérifiez que MySQL est démarré (MAMP) et les variables DB_* de .env.');
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
