// Autorise une route seulement pour certains rôles : requireRole('admin', 'super_admin')
// Le rôle est relu en base à chaque requête : une rétrogradation prend effet immédiatement.
const path = require('path');
const db = require('../config/db');

const PAGE_404 = path.join(__dirname, '..', 'public', '404.html');
const isApi = (req) => req.originalUrl.startsWith('/api/');

function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      // 1. Non connecté → 401 (API) ou redirection /login (page)
      const userId = req.user?.id;
      if (!userId) {
        if (isApi(req)) return res.status(401).json({ error: 'Non authentifié' });
        return res.redirect('/login');
      }

      // 2. Rôle et statut relus en base (pas dans la session)
      const [rows] = await db.execute('SELECT role, statut FROM users WHERE id = ?', [userId]);
      const compte = rows[0];

      // 3. Connecté mais rôle absent de la liste (ou compte suspendu entre-temps)
      if (!compte || compte.statut !== 'actif' || !roles.includes(compte.role)) {
        if (isApi(req)) return res.status(403).json({ error: 'Accès refusé' });
        // Une page 404 plutôt que 403 : on ne signale pas l'existence de l'administration
        return res.status(404).sendFile(PAGE_404);
      }

      req.user.role = compte.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireRole };
