// Jeux concours : questionnaire payant en ligne, puis rencontre en présentiel.
// Contient les jeux (questionnaire PDF, nombre de cases de réponses) et les participations.
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
  date_ouverture: { type: 'datetime', requis: true, libelle: 'Ouverture des participations' },
  date_cloture: { type: 'datetime', requis: true, libelle: 'Clôture des réponses' },
  nb_reponses: { type: 'entier', min: 1, max: 100, requis: true, libelle: 'Nombre de cases de réponses' },
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
    nb_questions: Number(j.nb_questions ?? 0),
    nb_reponses: Number(j.nb_reponses ?? 0),
    a_formulaire: Boolean(j.a_formulaire ?? j.formulaire_pdf)
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
    `SELECT j.id, j.titre, j.description, j.reglement, j.image, j.prix, j.date_ouverture, j.date_cloture, j.duree_minutes, j.nb_reponses,
            j.rencontre_date, j.rencontre_lieu, j.rencontre_infos, j.rencontre_publiee, ${PHASE} AS phase, ${NB_QUESTIONS} AS nb_questions,
            (j.formulaire_pdf IS NOT NULL) AS a_formulaire
     FROM jeux j WHERE ${conditions.join(' AND ')}
     ORDER BY FIELD(${PHASE}, 'ouvert', 'a-venir', 'clos'), j.date_ouverture DESC${lim}`,
    valeurs
  );
  return lignes.map(versionPublique);
}

async function trouverPublic(id) {
  const [lignes] = await db.execute(
    `SELECT j.id, j.titre, j.description, j.reglement, j.image, j.prix, j.date_ouverture, j.date_cloture, j.duree_minutes, j.nb_reponses,
            j.rencontre_date, j.rencontre_lieu, j.rencontre_infos, j.rencontre_publiee, ${PHASE} AS phase, ${NB_QUESTIONS} AS nb_questions,
            (j.formulaire_pdf IS NOT NULL) AS a_formulaire
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
   Participations
   --------------------------------------------------------------------- */
// Une participation = un achat. Le joueur envoie ses réponses (cases de texte et/ou photos)
// et peut les modifier jusqu'à la clôture ; l'administration examine ensuite et note.
const lireJSON = (texte, defaut) => { try { const v = JSON.parse(texte); return v ?? defaut; } catch { return defaut; } };
const lireReponses = (texte) => { const v = lireJSON(texte, []); return Array.isArray(v) ? v.map((r) => String(r ?? '')) : []; };
const lirePhotos = (texte) => { const v = lireJSON(texte, []); return Array.isArray(v) ? v.filter((f) => typeof f === 'string') : []; };

async function trouverParticipation(jeuId, userId) {
  const [lignes] = await db.execute('SELECT * FROM participations WHERE jeu_id = ? AND user_id = ?', [jeuId, userId]);
  const p = lignes[0];
  return p ? { ...p, reponses: lireReponses(p.reponses), photos: lirePhotos(p.photos) } : null;
}

async function trouverParticipationParId(id) {
  const [lignes] = await db.execute('SELECT * FROM participations WHERE id = ?', [id]);
  const p = lignes[0];
  return p ? { ...p, reponses: lireReponses(p.reponses), photos: lirePhotos(p.photos) } : null;
}

// Ce que le participant voit de sa participation : ses réponses, le nombre de photos, jamais la note
function versionParticipant(p) {
  if (!p) return null;
  return {
    statut: p.statut,
    statut_libelle: libelle('statutParticipation', p.statut),
    resultat: p.resultat,
    resultat_libelle: libelle('resultat', p.resultat),
    soumis_le: p.soumis_le || null,
    reponses: p.reponses,
    nb_photos: p.photos.length
  };
}

// Enregistre (ou remplace) les réponses. photos : nouvelle liste de fichiers, ou undefined pour garder les anciennes
async function enregistrerSoumission(participationId, reponses, photos) {
  const valeurs = [JSON.stringify(reponses)];
  let sqlPhotos = '';
  if (photos !== undefined) { sqlPhotos = ', photos = ?'; valeurs.push(JSON.stringify(photos)); }
  await db.execute(
    `UPDATE participations SET statut = 'terminee', reponses = ?${sqlPhotos}, soumis_le = NOW(), fin_le = NOW() WHERE id = ?`,
    [...valeurs, participationId]
  );
}

// Administration : réponses envoyées d'abord, triées par note (la plus haute), puis par date d'envoi
async function listerParticipations(jeuId) {
  const [lignes] = await db.execute(
    `SELECT p.id, p.statut, p.resultat, p.score, p.reponses, p.photos, p.soumis_le, p.cree_le,
            u.email, pa.montant, pa.operateur, pa.transaction_id, pa.telephone
     FROM participations p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN paiements pa ON pa.id = p.paiement_id
     WHERE p.jeu_id = ?
     ORDER BY (p.statut = 'terminee') DESC, (p.score IS NULL) ASC, p.score DESC, p.soumis_le ASC, p.cree_le ASC`,
    [jeuId]
  );
  return lignes.map((p, i) => {
    const soumis = p.statut === 'terminee';
    return {
      id: p.id,
      email: p.email,
      statut: p.statut,
      rang: soumis && p.score !== null ? i + 1 : null,
      statut_libelle: libelle('statutParticipation', p.statut),
      resultat: p.resultat,
      resultat_libelle: libelle('resultat', p.resultat),
      note: p.score,
      soumis_le: p.soumis_le,
      reponses: lireReponses(p.reponses),
      nb_photos: lirePhotos(p.photos).length,
      operateur: p.operateur,
      montant: p.montant
    };
  });
}

// Note donnée par l'administration après examen (null = pas encore notée)
async function changerNote(participationId, note) {
  const [r] = await db.execute('UPDATE participations SET score = ? WHERE id = ?', [note, participationId]);
  return r.affectedRows === 1;
}

async function changerResultat(participationId, resultat) {
  const [r] = await db.execute('UPDATE participations SET resultat = ? WHERE id = ?', [resultat, participationId]);
  return r.affectedRows === 1;
}

// Retient les N premiers du classement (questionnaire terminé), les autres deviennent « non retenus »
async function retenirMeilleurs(jeuId, nombre) {
  // Seules les soumissions notées comptent, de la meilleure note à la plus basse
  const classement = (await listerParticipations(jeuId)).filter((p) => p.statut === 'terminee' && p.note !== null);
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
// Ajoute les colonnes récentes si la base a été créée avant (questionnaire PDF, cases de réponses, photos)
async function initialiser() {
  const [colonnes] = await db.execute(
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('jeux', 'participations')"
  );
  const existe = (table, colonne) => colonnes.some((c) => c.TABLE_NAME === table && c.COLUMN_NAME === colonne);
  const AJOUTS = [
    ['jeux', 'formulaire_pdf', 'VARCHAR(64) DEFAULT NULL AFTER image'],
    ['jeux', 'formulaire_nom', 'VARCHAR(150) DEFAULT NULL AFTER formulaire_pdf'],
    ['jeux', 'nb_reponses', 'SMALLINT UNSIGNED NOT NULL DEFAULT 10 AFTER duree_minutes'],
    ['participations', 'photos', 'TEXT DEFAULT NULL AFTER reponses'],
    ['participations', 'soumis_le', 'DATETIME DEFAULT NULL AFTER fin_le']
  ];
  for (const [table, colonne, definition] of AJOUTS) {
    if (!existe(table, colonne)) await db.query(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
  }
}

module.exports = {
  initialiser,
  validerJeu, prixLisible,
  listerPublic, trouverPublic, lister, trouver, creer, modifier, supprimer, compterParticipations,
  trouverParticipation, trouverParticipationParId, versionParticipant, enregistrerSoumission,
  listerParticipations, changerNote, changerResultat, retenirMeilleurs, mesParticipations
};
