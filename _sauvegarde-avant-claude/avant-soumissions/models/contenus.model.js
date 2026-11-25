// Modèle commun aux contenus simples gérés depuis l'administration (aujourd'hui : les annonces).
// Chaque contenu est décrit une seule fois ici (table, champs, règles, rôles) ;
// les routes d'administration et l'API publique s'appuient sur cette description.
// Pour ajouter un contenu (ex. des partenaires), il suffit d'ajouter une entrée à RESSOURCES.
const db = require('../config/db');
const { libelle, LIBELLES } = require('../utils/libelles');

const ADMINS = ['admin', 'super_admin'];

/* Types de champs :
   texte  { max, requis, motif, messageMotif }   entier { min, max, requis, defaut }
   booleen (case à cocher)                       choix  { valeurs, requis }
   date   (AAAA-MM-JJ)                           url    (http/https)
   lien   (/chemin-du-site ou http/https)                                         */
const RESSOURCES = {
  annonces: {
    table: 'annonces',
    nom: 'Annonce',
    roles: ADMINS,
    titre: 'titre',
    image: null,
    tri: 'date_publication DESC, id DESC',
    champs: {
      type: { type: 'choix', valeurs: Object.keys(LIBELLES.typeAnnonce), requis: true, libelle: 'Type' },
      titre: { type: 'texte', max: 150, requis: true, libelle: 'Titre' },
      lieu: { type: 'texte', max: 80, libelle: 'Lieu' },
      description: { type: 'texte', max: 2000, requis: true, libelle: 'Description' },
      date_publication: { type: 'date', requis: true, libelle: 'Date de publication' },
      date_expiration: { type: 'date', libelle: "Date d'expiration" },
      statut: { type: 'choix', valeurs: Object.keys(LIBELLES.statutAnnonce), requis: true, libelle: 'Statut' }
    },
    // Visible si publiée, date de publication atteinte et pas encore expirée (jusqu'à la fin du jour d'expiration)
    public: {
      colonnes: 'id, type, titre, lieu, description, date_publication, date_expiration, lien, texte_lien',
      condition: "statut = 'publiee' AND (date_publication IS NULL OR date_publication <= NOW())" +
                 ' AND (date_expiration IS NULL OR date_expiration >= CURDATE())'
    },
    verifier: (v) => (v.date_expiration && v.date_publication && v.date_expiration < v.date_publication
      ? [{ champ: 'date_expiration', message: "La date d'expiration doit suivre la date de publication" }]
      : []),
    decorer: (l) => ({
      ...l,
      type_libelle: libelle('typeAnnonce', l.type),
      statut_libelle: l.statut ? libelle('statutAnnonce', l.statut) : undefined
    })
  }
};

const URL_WEB = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Vérifie et nettoie les champs envoyés par un formulaire, d'après leur description (champs).
// Renvoie { valeurs, erreurs } ; erreurs a le même format que handleValidation : [{ champ, message }]
// Utilisé pour les annonces et pour les jeux concours (models/jeux.model.js).
function validerChamps(champs, corps = {}, verifier = null) {
  corps = corps || {};
  const valeurs = {};
  const erreurs = [];
  const erreur = (champ, message) => erreurs.push({ champ, message });

  for (const [champ, regle] of Object.entries(champs)) {
    const brut = corps[champ];
    const texte = typeof brut === 'string' ? brut.trim() : '';

    if (regle.type === 'booleen') {
      // Une case cochée est envoyée (« on », « true », « 1 ») ; décochée, elle est absente
      valeurs[champ] = ['on', 'true', '1'].includes(String(brut).toLowerCase()) ? 1 : 0;
      continue;
    }
    if (brut !== undefined && typeof brut !== 'string' && typeof brut !== 'number') {
      erreur(champ, `${regle.libelle} : valeur invalide`);
      continue;
    }
    if (!texte) {
      if (regle.requis) erreur(champ, `${regle.libelle} : champ obligatoire`);
      valeurs[champ] = regle.type === 'entier' && regle.defaut !== undefined ? regle.defaut : null;
      continue;
    }

    switch (regle.type) {
      case 'texte':
        if (texte.length > regle.max) erreur(champ, `${regle.libelle} : ${regle.max} caractères maximum`);
        else if (regle.motif && !regle.motif.test(texte)) erreur(champ, regle.messageMotif);
        else valeurs[champ] = texte;
        break;
      case 'entier': {
        const nombre = Number(texte);
        if (!Number.isInteger(nombre) || nombre < regle.min || nombre > regle.max) {
          erreur(champ, `${regle.libelle} : nombre entier entre ${regle.min} et ${regle.max}`);
        } else valeurs[champ] = nombre;
        break;
      }
      case 'choix':
        if (!regle.valeurs.includes(texte)) erreur(champ, `${regle.libelle} : choix invalide`);
        else valeurs[champ] = texte;
        break;
      case 'date':
        if (!DATE.test(texte) || Number.isNaN(Date.parse(texte))) erreur(champ, `${regle.libelle} : date invalide`);
        else valeurs[champ] = `${texte} 00:00:00`;
        break;
      case 'datetime': {
        // « 2026-12-20T18:30 » (champ datetime-local) ou « 2026-12-20 18:30 »
        const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(texte);
        if (!m || Number.isNaN(Date.parse(`${m[1]}T${m[2]}:${m[3]}`))) erreur(champ, `${regle.libelle} : date et heure invalides`);
        else valeurs[champ] = `${m[1]} ${m[2]}:${m[3]}:00`;
        break;
      }
      case 'url':
        if (texte.length > regle.max || !URL_WEB.test(texte)) erreur(champ, `${regle.libelle} : adresse web invalide (https://…)`);
        else valeurs[champ] = texte;
        break;
      case 'lien': {
        // Lien interne (/devenir-membre?poste=…) ou adresse web complète ; « //site » et « javascript: » refusés.
        // Les espaces sont encodés (%20) pour que le lien reste valide.
        const lien = texte.replace(/ /g, '%20');
        if (lien.length > regle.max || !(URL_WEB.test(lien) || /^\/(?!\/)[^\s]*$/.test(lien))) {
          erreur(champ, `${regle.libelle} : commencez par / (page du site) ou par https://`);
        } else valeurs[champ] = lien;
        break;
      }
      default:
        break;
    }
  }

  if (!erreurs.length && verifier) erreurs.push(...verifier(valeurs));
  return { valeurs, erreurs };
}

const valider = (ressource, corps) => validerChamps(RESSOURCES[ressource].champs, corps, RESSOURCES[ressource].verifier);

const decorer = (ressource, lignes) => lignes.map(RESSOURCES[ressource].decorer);

// --- Administration ---
async function lister(ressource) {
  const { table, tri } = RESSOURCES[ressource];
  const [lignes] = await db.execute(`SELECT * FROM ${table} ORDER BY ${tri}`);
  return decorer(ressource, lignes);
}

async function trouver(ressource, id) {
  const [lignes] = await db.execute(`SELECT * FROM ${RESSOURCES[ressource].table} WHERE id = ?`, [id]);
  return lignes[0] ? decorer(ressource, lignes)[0] : null;
}

async function creer(ressource, valeurs) {
  const colonnes = Object.keys(valeurs);
  const [resultat] = await db.execute(
    `INSERT INTO ${RESSOURCES[ressource].table} (${colonnes.join(', ')})
     VALUES (${colonnes.map(() => '?').join(', ')})`,
    Object.values(valeurs)
  );
  return resultat.insertId;
}

async function modifier(ressource, id, valeurs) {
  const colonnes = Object.keys(valeurs);
  await db.execute(
    `UPDATE ${RESSOURCES[ressource].table} SET ${colonnes.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(valeurs), id]
  );
}

async function supprimer(ressource, id) {
  const [resultat] = await db.execute(`DELETE FROM ${RESSOURCES[ressource].table} WHERE id = ?`, [id]);
  return resultat.affectedRows > 0;
}

// --- Site public : uniquement les éléments visibles / publiés, et uniquement les colonnes utiles ---
async function listerPublic(ressource, { limite } = {}) {
  const { table, tri, public: pub } = RESSOURCES[ressource];
  const condition = pub.condition;
  const limiteSql = Number.isInteger(limite) && limite > 0 ? ` LIMIT ${Math.min(limite, 100)}` : '';
  const [lignes] = await db.execute(`SELECT ${pub.colonnes} FROM ${table} WHERE ${condition} ORDER BY ${tri}${limiteSql}`);
  return decorer(ressource, lignes);
}

module.exports = { RESSOURCES, valider, validerChamps, lister, trouver, creer, modifier, supprimer, listerPublic };
