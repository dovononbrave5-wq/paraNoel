const db = require('../config/db');

// Champs que le super-administrateur peut modifier (liste blanche : jamais de nom de colonne venant du navigateur)
const CHAMPS = [
  'nom', 'edition', 'annee', 'slogan', 'devise', 'presentation', 'description_courte',
  'date_evenement', 'lieu', 'telephone', 'whatsapp', 'email', 'adresse', 'horaires',
  'carte_url', 'lien_itineraire', 'facebook', 'instagram', 'tiktok',
  'histoire', 'mission', 'vision', 'engagement'
];

// « chiffres » est stocké en texte JSON : on le relit en tableau
function lireChiffres(valeur) {
  if (!valeur) return [];
  if (Array.isArray(valeur)) return valeur;
  try {
    const tableau = JSON.parse(valeur);
    return Array.isArray(tableau) ? tableau : [];
  } catch {
    return [];
  }
}

async function lire() {
  const [rows] = await db.execute('SELECT * FROM evenement WHERE id = 1');
  const ligne = rows[0] || { id: 1, nom: "Para'Noel", edition: 3 };
  return { ...ligne, chiffres: lireChiffres(ligne.chiffres) };
}

/**
 * valeurs : objet { nom, slogan, … } déjà validé ; chiffres : tableau ;
 * image : chemin public de la nouvelle photo, ou undefined pour garder l'actuelle
 */
async function modifier(valeurs, chiffres, image, userId) {
  const colonnes = CHAMPS.filter((champ) => champ in valeurs);
  const parametres = colonnes.map((champ) => (valeurs[champ] === '' ? null : valeurs[champ]));

  colonnes.push('chiffres');
  parametres.push(JSON.stringify(chiffres || []));
  if (image !== undefined) { colonnes.push('image_apropos'); parametres.push(image); }

  await db.execute(
    `UPDATE evenement SET ${colonnes.map((c) => `${c} = ?`).join(', ')},
       modifie_le = NOW(), modifie_par = ? WHERE id = 1`,
    [...parametres, userId]
  );
}

module.exports = { CHAMPS, lire, modifier };
