// Compte à rebours de l'accueil jusqu'à la date de l'événement (saisie dans l'administration).
// Le bloc reste masqué si aucune date n'est saisie ou si la date est passée.
(function () {
  const bloc = document.querySelector('[data-compte-a-rebours]');
  if (!bloc || !window.chargerJSON) return;

  const cases = {
    jours: bloc.querySelector('[data-unite="jours"]'),
    heures: bloc.querySelector('[data-unite="heures"]'),
    minutes: bloc.querySelector('[data-unite="minutes"]'),
    secondes: bloc.querySelector('[data-unite="secondes"]')
  };
  const FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  window.chargerJSON('/api/public/evenement').then((evenement) => {
    if (!evenement.date_evenement) return;
    const cible = new Date(String(evenement.date_evenement).replace(' ', 'T'));
    if (Number.isNaN(cible.getTime()) || cible <= new Date()) return;

    const date = bloc.querySelector('[data-compte-date]');
    date.textContent = `${FORMAT.format(cible)} ·`;
    date.dateTime = String(evenement.date_evenement).replace(' ', 'T');

    function majCompte() {
      const reste = Math.max(0, Math.floor((cible - Date.now()) / 1000));
      cases.jours.textContent = String(Math.floor(reste / 86400));
      cases.heures.textContent = String(Math.floor((reste % 86400) / 3600)).padStart(2, '0');
      cases.minutes.textContent = String(Math.floor((reste % 3600) / 60)).padStart(2, '0');
      cases.secondes.textContent = String(reste % 60).padStart(2, '0');
      if (reste === 0) clearInterval(minuterie);
    }
    const minuterie = setInterval(majCompte, 1000);
    majCompte();
    bloc.hidden = false;
  }).catch(() => { /* pas de compte à rebours si l'API ne répond pas */ });
})();
