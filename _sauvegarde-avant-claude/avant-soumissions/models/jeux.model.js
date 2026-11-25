// Jeux concours : questionnaire payant en ligne, puis rencontre en présentiel.
// Contient les jeux, leurs questions et les participations.
const db = require('../config/db');
const { validerChamps } = require('./contenus.model');
const { libelle } = require('../utils/libelles');

/* ---------------------------------------------------------------------
   Règles des formulaires de l'administration
   --------------------------------------------------------------------- */
const CHAMPS_JEU = {
  titre: { type: 'texte', max: 120, requis: true, libelle: 'Titre' },
  description: { type: 'texte', max: 2000, requis: true, libelle: 'Description' },
  reglement: { type: 'texte', max: 3000, libelle: 'Règlement' },
  prix: { type: 'entier', min: 100, max: 1000000, requis: true, libelle: 'Prix de participation' },
  date_ouverture: { type: 'datetime', requis: true, libelle: "Ouverture du questionnaire" },
  date_cloture: { type: 'datetime', requis: true, libelle: 'Clôture du questionnaire' },
  duree_minutes: { type: 'entier', min: 1, max: 180, requis: true, libelle: 'Durée du questionnaire' },
  statut: { type: 'choix', valeurs: ['brouillon', 'publie'], requis: true, libelle: 'Statut' },
  rencontre_date: { type: 'datetime', libelle: 'Date de la rencontre' },
  rencontre_lieu: { type: 'texte', max: 200, libelle: 'Lieu de la rencontre' },
  rencontre_infos: { type: 'texte', max: 1000, libelle: 'Informations sur la rencontre' },
  rencontre_publiee: { type: 'booleen' }
};

function verifierJeu(v) {
  const erreurs = [];
  if (v.date_ouverture && v.date_cloture && v.date_cloture <= v.date_ouverture) {
    erreurs.push({ champ: 'date_cloture', message: "La clôture doit être après l'ouverture" });
  }
  if (v.rencontre_publiee && (!v.rencontre_date || !v.rencontre_lieu)) {
    erreurs.push({ champ: 'rencontre_date', message: 'Pour publier la rencontre, indiquez sa date et son lieu' });
  }
  return erreurs;
}

const validerJeu = (corps) => validerChamps(CHAMPS_JEU, corps, verifierJeu);

// Questions envoyées en JSON : [{ intitule, choix: ['…', '…'], bonne_reponse: 0, points: 1 }]
function validerQuestions(liste) {
  const erreurs = [];
  if (!Array.isArray(liste) || liste.length === 0) return { erreurs: [{ champ: 'questions', message: 'Ajoutez au moins une question' }] };
  if (liste.length > 100) return { erreurs: [{ champ: 'questions', message: '100 questions au maximum' }] };

  const questions = liste.map((q, i) => {
    const n = i + 1;
    const intitule = typeof q?.intitule === 'string' ? q.intitule.trim() : '';
    const choix = Array.isArray(q?.choix) ? q.choix.map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean) : [];
    const bonne = Number(q?.bonne_reponse);
    const points = q?.points === undefined || q?.points === '' ? 1 : Number(q.points);

    if (!intitule || intitule.length > 500) erreurs.push({ champ: `q${n}`, message: `Question ${n} : intitulé obligatoire (500 caractères maximum)` });
    if (choix.length < 2 || choix.length > 6) erreurs.push({ champ: `q${n}`, message: `Question ${n} : entre 2 et 6 réponses possibles` });
    if (choix.some((c) => c.length > 200)) erreurs.push({ champ: `q${n}`, message: `Question ${n} : une réponse dépasse 200 caractères` });
    if (!Number.isInteger(bonne) || bonne < 0 || bonne >= choix.length) erreurs.push({ champ: `q${n}`, message: `Question ${n} : choisissez la bonne réponse` });
    if (!Number.isInteger(points) || points < 1 || points > 10) erreurs.push({ champ: `q${n}`, message: `Question ${n} : points entre 1 et 10` });
    return { intitule, choix, bonne_reponse: bonne, points };
  });
  return { questions, erreurs };
}

/* ---------------------------------------------------------------------
   Lecture des jeux
   --------------------------------------------------------------------- */
// La phase est calculée par MySQL avec son heure : aucune différence de fuseau entre serveur et base
const PHASE = "CASE WHEN NOW() < j.date_ouverture THEN 'a-venir' WHEN NOW() > j.date_cloture THEN 'clos' ELSE 'ouvert' END";
const NB_QUESTIONS = '(SELECT COUNT(*) FROM questions q WHERE q.jeu_id = j.id)';
const prixLisible = (prix) => `${new Intl.NumberFormat('fr-FR').format(prix).replace(/ | /g, ' ')} FCFA`;

function decorer(j) {
  return {
    ...j,
    lien: `/participer?jeu=${j.id}`,
    rencontre_publiee: Boolean(j.rencontre_publiee),
    phase_libelle: libelle('phaseJeu', j.phase),
    statut_libelle: j.statut ? libelle('statutJeu', j.statut) : undefined,
    prix_libelle: prixLisible(j.prix),
    nb_questions: Number(j.nb_questions ?? 0)
  };
}

// Version publique : la rencontre n'apparaît que lorsqu'elle est publiée
function versionPublique(j) {
  const publique = decorer(j);
  if (!publique.rencontre_publiee) {
    publique.rencontre_date = null;
    publique.rencontre_lieu = null;
    publique.rencontre_infos = null;
  }
  return publique;
}

async function listerPublic({ phase, limite } = {}) {
  const conditions = ["j.statut = 'publie'"];
  const valeurs = [];
  if (['a-venir', 'ouvert', 'clos'].includes(phase)) { conditions.push(`${PHASE} = ?`); valeurs.push(phase); }
  const lim = Number.isInteger(limite) && limite > 0 ? ` LIMIT ${Math.min(limite, 50)}` : '';
  const [lignes] = await db.execute(
    `SELECT j.id, j.titre, j.description, j.reglement, j.image, j.prix, j.date_ouverture, j.date_cloture, j.duree_minutes,
            j.rencontre_date, j.rencontre_lieu, j.rencontre_infos, j.rencontre_publiee, ${PHASE} AS phase, ${NB_QUESTIONS} AS nb_questions
     FROM jeux j WHERE ${conditions.join(' AND ')}
     ORDER BY FIELD(${PHASE}, 'ouvert', 'a-venir', 'clos'), j.date_ouverture DESC${lim}`,
    valeurs
  );
  return lignes.map(versionPublique);
}

async function trouverPublic(id) {
  const [lignes] = await db.execute(
    `SELECT j.id, j.titre, j.description, j.reglement, j.image, j.prix, j.date_ouverture, j.date_cloture, j.duree_minutes,
            j.rencontre_date, j.rencontre_lieu, j.rencontre_infos, j.rencontre_publiee, ${PHASE} AS phase, ${NB_QUESTIONS} AS nb_questions
     FROM jeux j WHERE j.id = ? AND j.statut = 'publie'`,
    [id]
  );
  return lignes[0] ? versionPublique(lignes[0]) : null;
}

// Administration : tout, avec le nombre de participants payés et les recettes
async function lister() {
  const [lignes] = await db.execute(
    `SELECT j.*, ${PHASE} AS phase, ${NB_QUESTIONS} AS nb_questions,
            (SELECT COUNT(*) FROM participations p WHERE p.jeu_id = j.id) AS nb_participants,
            (SELECT COALESCE(SUM(pa.montant), 0) FROM paiements pa WHERE pa.jeu_id = j.id AND pa.statut = 'reussi') AS recettes
     FROM jeux j ORDER BY j.date_ouverture DESC, j.id DESC`
  );
  return lignes.map((j) => ({ ...decorer(j), nb_participants: Number(j.nb_participants), recettes: Number(j.recettes), recettes_libelle: prixLisible(Number(j.recettes)) }));
}

async function trouver(id) {
  const [lignes] = await db.execute(`SELECT j.*, ${PHASE} AS phase, ${NB_QUESTIONS} AS nb_questions FROM jeux j WHERE j.id = ?`, [id]);
  return lignes[0] ? decorer(lignes[0]) : null;
}

async function creer(valeurs, image, formulaire) {
  const v = { ...valeurs, image: image || null };
  if (formulaire) { v.formulaire_pdf = formulaire.fichier; v.formulaire_nom = formulaire.nom; }
  const colonnes = Object.keys(v);
  const [r] = await db.execute(
    `INSERT INTO jeux (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`,
    Object.values(v)
  );
  return r.insertId;
}

async function modifier(id, valeurs, image, formulaire) {
  const v = { ...valeurs };
  if (image !== undefined) v.image = image;
  // formulaire : { fichier, nom } pour remplacer, null pour retirer, undefined pour garder
  if (formulaire !== undefined) { v.formulaire_pdf = formulaire?.fichier ?? null; v.formulaire_nom = formulaire?.nom ?? null; }
  const colonnes = Object.keys(v);
  await db.execute(`UPDATE jeux SET ${colonnes.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...Object.values(v), id]);
}

async function supprimer(id) {
  await db.execute('DELETE FROM jeux WHERE id = ?', [id]);
}

async function compterParticipations(jeuId, { commencees = false } = {}) {
  const [[{ n }]] = await db.execute(
    `SELECT COUNT(*) AS n FROM participations WHERE jeu_id = ? ${commencees ? "AND statut <> 'payee'" : ''}`,
    [jeuId]
  );
  return Number(n);
}

/* ---------------------------------------------------------------------
   Questions
   --------------------------------------------------------------------- */
const lireChoix = (texte) => { try { return JSON.parse(texte); } catch { return []; } };

// avecReponses : true seulement pour l'administration et pour la correction, jamais pour le navigateur d'un participant
async function lireQuestions(jeuId, { avecReponses = false } = {}) {
  const [lignes] = await db.execute(
    'SELECT id, ordre, intitule, choix, bonne_reponse, points FROM questions WHERE jeu_id = ? ORDER BY ordre, id',
    [jeuId]
  );
  return lignes.map((q) => {
    const question = { id: q.id, intitule: q.intitule, choix: lireChoix(q.choix), points: q.points };
    if (avecReponses) question.bonne_reponse = q.bonne_reponse;
    return question;
  });
}

// Remplace toutes les questions d'un jeu en une seule transaction (tout ou rien)
async function remplacerQuestions(jeuId, questions) {
  const connexion = await db.getConnection();
  try {
    await connexion.beginTransaction();
    await connexion.execute('DELETE FROM questions WHERE jeu_id = ?', [jeuId]);
    for (const [i, q] of questions.entries()) {
      await connexion.execute(
        'INSERT INTO questions (jeu_id, ordre, intitule, choix, bonne_reponse, points) VALUES (?, ?, ?, ?, ?, ?)',
        [jeuId, i + 1, q.intitule, JSON.stringify(q.choix), q.bonne_reponse, q.points]
      );
    }
    await connexion.commit();
  } catch (err) {
    await connexion.rollback();
    throw err;
  } finally {
    connexion.release();
  }
}

/* ---------------------------------------------------------------------
   Participations
   --------------------------------------------------------------------- */
const TOLERANCE_SECONDES = 30; // marge pour la lenteur du réseau à l'envoi des réponses

async function trouverParticipation(jeuId, userId) {
  const [lignes] = await db.execute(
    `SELECT p.*, j.duree_minutes,
            TIMESTAMPDIFF(SECOND, p.debut_le, NOW()) AS secondes_ecoulees
     FROM participations p JOIN jeux j ON j.id = p.jeu_id
     WHERE p.jeu_id = ? AND p.user_id = ?`,
    [jeuId, userId]
  );
  const p = lignes[0];
  if (!p) return null;
  const restantes = p.debut_le ? p.duree_minutes * 60 - Number(p.secondes_ecoulees) : p.duree_minutes * 60;
  return { ...p, secondes_restantes: restantes };
}

// Ce que le participant peut voir de sa participation (ni réponses, ni score)
function versionParticipant(p) {
  if (!p) return null;
  return {
    statut: p.statut,
    statut_libelle: libelle('statutParticipation', p.statut),
    resultat: p.resultat,
    resultat_libelle: libelle('resultat', p.resultat),
    debut_le: p.debut_le,
    fin_le: p.fin_le,
    secondes_restantes: p.statut === 'en_cours' ? Math.max(0, p.secondes_restantes) : null
  };
}

// Passe de « payée » à « en cours » : le chronomètre démarre (heure de la base)
async function demarrer(participationId) {
  const [r] = await db.execute(
    "UPDATE participations SET statut = 'en_cours', debut_le = NOW() WHERE id = ? AND statut = 'payee'",
    [participationId]
  );
  return r.affectedRows === 1;
}

// Corrige les réponses ({ idQuestion: positionChoisie }) et clôt la participation.
// enRetard : le temps est dépassé, la participation est close avec 0 point.
async function terminer(participation, reponses, { enRetard = false } = {}) {
  const questions = await lireQuestions(participation.jeu_id, { avecReponses: true });
  const total = questions.reduce((somme, q) => somme + q.points, 0);
  const propres = {};
  let score = 0;
  if (!enRetard) {
    questions.forEach((q) => {
      const choix = Number(reponses?.[q.id]);
      if (Number.isInteger(choix) && choix >= 0 && choix < q.choix.length) {
        propres[q.id] = choix;
        if (choix === q.bonne_reponse) score += q.points;
      }
    });
  }
  // « AND statut = 'en_cours' » : un double envoi ne peut pas corriger deux fois
  const [r] = await db.execute(
    `UPDATE participations SET statut = 'terminee', fin_le = NOW(), reponses = ?, score = ?, total = ?
     WHERE id = ? AND statut = 'en_cours'`,
    [JSON.stringify(propres), score, total, participation.id]
  );
  return r.affectedRows === 1;
}

// Classement de l'administration : meilleur score, puis le plus rapide
async function listerParticipations(jeuId) {
  const [lignes] = await db.execute(
    `SELECT p.id, p.statut, p.resultat, p.score, p.total, p.debut_le, p.fin_le, p.cree_le,
            TIMESTAMPDIFF(SECOND, p.debut_le, p.fin_le) AS duree_secondes,
            u.email, pa.montant, pa.operateur, pa.transaction_id, pa.telephone
     FROM participations p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN paiements pa ON pa.id = p.paiement_id
     WHERE p.jeu_id = ?
     ORDER BY (p.statut = 'terminee') DESC, p.score DESC, duree_secondes ASC, p.cree_le ASC`,
    [jeuId]
  );
  return lignes.map((p, i) => ({
    ...p,
    rang: p.statut === 'terminee' ? i + 1 : null,
    statut_libelle: libelle('statutParticipation', p.statut),
    resultat_libelle: libelle('resultat', p.resultat),
    score_libelle: p.statut === 'terminee' ? `${p.score} / ${p.total}` : '–',
    duree_libelle: p.duree_secondes == null ? '–' : `${Math.floor(p.duree_secondes / 60)} min ${String(p.duree_secondes % 60).padStart(2, '0')} s`
  }));
}

async function changerResultat(participationId, resultat) {
  const [r] = await db.execute('UPDATE participations SET resultat = ? WHERE id = ?', [resultat, participationId]);
  return r.affectedRows === 1;
}

// Retient les N premiers du classement (questionnaire terminé), les autres deviennent « non retenus »
async function retenirMeilleurs(jeuId, nombre) {
  const classement = (await listerParticipations(jeuId)).filter((p) => p.statut === 'terminee');
  const retenus = classement.slice(0, nombre).map((p) => p.id);
  const autres = classement.slice(nombre).map((p) => p.id);
  if (retenus.length) await db.query("UPDATE participations SET resultat = 'retenu' WHERE id IN (?)", [retenus]);
  if (autres.length) await db.query("UPDATE participations SET resultat = 'non_retenu' WHERE id IN (?)", [autres]);
  return { retenus: retenus.length, nonRetenus: autres.length };
}

// Espace membre : ses participations, avec la rencontre si elle est publiée
async function mesParticipations(userId) {
  const [lignes] = await db.execute(
    `SELECT p.jeu_id, p.statut, p.resultat, p.cree_le, j.titre, j.date_cloture,
            j.rencontre_publiee, j.rencontre_date, j.rencontre_lieu, j.rencontre_infos, ${PHASE} AS phase
     FROM participations p JOIN jeux j ON j.id = p.jeu_id
     WHERE p.user_id = ? ORDER BY p.cree_le DESC`,
    [userId]
  );
  return lignes.map((l) => ({
    jeu_id: l.jeu_id,
    titre: l.titre,
    phase: l.phase,
    phase_libelle: libelle('phaseJeu', l.phase),
    inscrit_le: l.cree_le,
    date_cloture: l.date_cloture,
    statut: l.statut,
    statut_libelle: libelle('statutParticipation', l.statut),
    resultat: l.resultat,
    resultat_libelle: libelle('resultat', l.resultat),
    rencontre: l.rencontre_publiee ? { date: l.rencontre_date, lieu: l.rencontre_lieu, infos: l.rencontre_infos } : null
  }));
}

// Ajoute les colonnes du formulaire PDF si la base a été créée avant cette fonctionnalité
async function initialiser() {
  const [colonnes] = await db.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jeux' AND COLUMN_NAME IN ('formulaire_pdf', 'formulaire_nom')"
  );
  const presentes = colonnes.map((c) => c.COLUMN_NAME);
  if (!presentes.includes('formulaire_pdf')) await db.query('ALTER TABLE jeux ADD COLUMN formulaire_pdf VARCHAR(64) DEFAULT NULL AFTER image');
  if (!presentes.includes('formulaire_nom')) await db.query('ALTER TABLE jeux ADD COLUMN formulaire_nom VARCHAR(150) DEFAULT NULL AFTER formulaire_pdf');
}

module.exports = {
  initialiser,
  validerJeu, validerQuestions, prixLisible,
  listerPublic, trouverPublic, lister, trouver, creer, modifier, supprimer, compterParticipations,
  lireQuestions, remplacerQuestions,
  TOLERANCE_SECONDES, trouverParticipation, versionParticipant, demarrer, terminer,
  listerParticipations, changerResultat, retenirMeilleurs, mesParticipations
};
