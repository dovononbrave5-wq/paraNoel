const db = require('../config/db');

async function ajouter({ userId, email, action, detail, ip }) {
  await db.execute(
    'INSERT INTO journal_activite (user_id, email, action, detail, ip) VALUES (?, ?, ?, ?, ?)',
    [userId, email, action, detail, ip]
  );
}

// Filtres : action (catégorie exacte), utilisateur (morceau d'e-mail), du / au (AAAA-MM-JJ)
function construireFiltres({ action, utilisateur, du, au, actions } = {}) {
  const conditions = [];
  const valeurs = [];
  if (action) { conditions.push('action = ?'); valeurs.push(action); }
  if (actions?.length) { conditions.push(`action IN (${actions.map(() => '?').join(',')})`); valeurs.push(...actions); }
  if (utilisateur) { conditions.push('email LIKE ?'); valeurs.push(`%${utilisateur}%`); }
  if (du) { conditions.push('date >= ?'); valeurs.push(`${du} 00:00:00`); }
  if (au) { conditions.push('date < DATE_ADD(?, INTERVAL 1 DAY)'); valeurs.push(au); }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', valeurs };
}

async function lister(filtres = {}, page = 1, parPage = 25) {
  const { where, valeurs } = construireFiltres(filtres);
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM journal_activite ${where}`, valeurs);
  const decalage = (page - 1) * parPage;
  // LIMIT/OFFSET : nombres entiers déjà contrôlés, insérés directement (execute les refuse en paramètres)
  const [lignes] = await db.execute(
    `SELECT id, user_id, email, action, detail, ip, date FROM journal_activite ${where}
     ORDER BY date DESC, id DESC LIMIT ${Number(parPage)} OFFSET ${Number(decalage)}`,
    valeurs
  );
  return { lignes, total };
}

async function recents(limite = 8, actions = null) {
  const { lignes } = await lister({ actions }, 1, limite);
  return lignes;
}

module.exports = { ajouter, lister, recents };
