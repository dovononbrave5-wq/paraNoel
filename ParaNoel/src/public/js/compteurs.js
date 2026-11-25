// Animation des chiffres clés de l'accueil : de 0 jusqu'à data-cible quand ils deviennent visibles.
// data-cible est posé par listes.js (data-cible-depuis="valeur").
(function () {
  const reduire = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const format = new Intl.NumberFormat('fr-FR');
  const DUREE = 1600; // ms

  function animer(el) {
    if (el.dataset.anime) return;
    el.dataset.anime = '1';
    const cible = Number(el.dataset.cible) || 0;
    if (reduire || cible === 0) {
      el.textContent = format.format(cible);
      return;
    }
    const debut = performance.now();
    function etape(maintenant) {
      const t = Math.min(1, (maintenant - debut) / DUREE);
      const adouci = 1 - Math.pow(1 - t, 3); // ralentit à la fin
      el.textContent = format.format(Math.round(cible * adouci));
      if (t < 1) requestAnimationFrame(etape);
    }
    requestAnimationFrame(etape);
  }

  const observateur = 'IntersectionObserver' in window
    ? new IntersectionObserver((entrees) => {
      entrees.forEach((entree) => {
        if (entree.isIntersecting) {
          animer(entree.target);
          observateur.unobserve(entree.target);
        }
      });
    }, { threshold: 0.4 })
    : null;

  function preparer() {
    document.querySelectorAll('.chiffre__valeur[data-cible]:not([data-anime])').forEach((el) => {
      if (!reduire) el.textContent = '0'; // l'animation part de zéro
      if (observateur) observateur.observe(el);
      else animer(el);
    });
  }

  document.addEventListener('liste:chargee', preparer);
  preparer();
})();
