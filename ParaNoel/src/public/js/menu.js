// Menu principal : ouverture/fermeture sur mobile, ombre de l'en-tête au défilement,
// et bouton « Mon espace » à la place de « Se connecter » pour un utilisateur connecté.
(function () {
  const bouton = document.querySelector('.menu-bouton');
  const menu = document.getElementById('menu-principal');
  const entete = document.querySelector('.entete');

  if (bouton && menu) {
    const texte = bouton.querySelector('.sr-only');

    function basculer(ouvrir) {
      bouton.setAttribute('aria-expanded', String(ouvrir));
      menu.classList.toggle('nav--ouverte', ouvrir);
      document.body.classList.toggle('menu-ouvert', ouvrir);
      if (texte) texte.textContent = ouvrir ? 'Fermer le menu' : 'Ouvrir le menu';
    }

    bouton.addEventListener('click', () => basculer(bouton.getAttribute('aria-expanded') !== 'true'));

    // Échap ferme le menu et rend le focus au bouton
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && bouton.getAttribute('aria-expanded') === 'true') {
        basculer(false);
        bouton.focus();
      }
    });

    // Un clic sur un lien (ex. /contact#formulaire) referme le menu
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) basculer(false);
    });

    // Retour en affichage large : le menu mobile est refermé
    window.matchMedia('(min-width: 64em)').addEventListener('change', (event) => {
      if (event.matches) basculer(false);
    });
  }

  // Ombre sous l'en-tête dès que la page défile
  if (entete) {
    const majOmbre = () => entete.classList.toggle('entete--defile', window.scrollY > 8);
    window.addEventListener('scroll', majOmbre, { passive: true });
    majOmbre();
  }

  // Utilisateur connecté : « Se connecter » devient « Mon espace » (vers /dashboard ou /admin)
  const lienConnexion = document.querySelector('.nav__actions a[href="/login"]');
  if (lienConnexion) {
    fetch('/api/public/session', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        if (session?.connecte) {
          lienConnexion.textContent = 'Mon espace';
          lienConnexion.href = session.accueil;
        }
      })
      .catch(() => { /* hors ligne : on garde « Se connecter » */ });
  }
})();
