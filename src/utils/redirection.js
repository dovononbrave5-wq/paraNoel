// Page d'arrivée après la connexion, selon le rôle.
// Dans un fichier séparé pour éviter les imports circulaires (contrôleur ↔ middlewares).
function pageAccueilSelonRole(user) {
  return user && (user.role === 'admin' || user.role === 'super_admin') ? '/admin' : '/dashboard';
}

module.exports = { pageAccueilSelonRole };
