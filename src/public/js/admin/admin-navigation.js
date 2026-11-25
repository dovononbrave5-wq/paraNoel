// Une seule rubrique visible à la fois, choisie d'après l'ancre de l'adresse (#messages, #annonces…).
// À chaque affichage, l'événement « admin:section » prévient le script de la rubrique pour qu'il charge ses données.
(function () {
  const { pret } = window.Admin;

  function afficher(premiereFois = false) {
    const sections = [...document.querySelectorAll('[data-section]')];
    const demandee = location.hash.slice(1);
    const active = sections.find((s) => s.id === demandee) || document.getElementById('apercu');

    sections.forEach((s) => { s.hidden = s !== active; });
    document.querySelectorAll('.admin-nav [data-section-lien]').forEach((lien) => {
      if (lien.dataset.sectionLien === active.id) lien.setAttribute('aria-current', 'page');
      else lien.removeAttribute('aria-current');
    });

    document.title = `${active.querySelector('h2')?.textContent || 'Administration'} | Administration Para'Noel`;
    if (!premiereFois) {
      // Focus sur le titre pour les lecteurs d'écran, puis retour en haut
      const titre = active.querySelector('h2');
      if (titre) {
        titre.tabIndex = -1;
        titre.focus({ preventScroll: true });
      }
      window.scrollTo({ top: 0 });
    }
    document.dispatchEvent(new CustomEvent('admin:section', { detail: { id: active.id } }));
  }

  pret.then(() => {
    window.addEventListener('hashchange', () => afficher());
    afficher(true);
  }).catch(() => {});
})();
