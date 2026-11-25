// Rubrique « Informations de l'événement » (super-administrateur) :
// GET /api/admin/evenement pour remplir le formulaire, PUT /api/admin/evenement pour enregistrer.
(function () {
  const { api, notifier, formatDate, erreursFormulaire, succesFormulaire } = window.Admin;

  function remplirFormulaire(form, evenement) {
    [...form.elements].forEach((el) => {
      if (!el.name || el.type === 'file' || el.type === 'submit') return;
      const valeur = evenement[el.name] ?? '';
      // « 2026-12-20 16:00:00 » → « 2026-12-20T16:00 » pour un champ date et heure
      el.value = el.type === 'datetime-local' && valeur ? String(valeur).replace(' ', 'T').slice(0, 16) : valeur;
    });
    form.elements.image_apropos.value = '';
    document.getElementById('evenement-modifie-le').textContent = formatDate(evenement.modifie_le);
  }

  async function charger(form) {
    try {
      remplirFormulaire(form, await api('/api/admin/evenement'));
    } catch (err) {
      notifier(`Informations de l'événement : ${err.message}`, 'erreur');
    }
  }

  // Écouté dès maintenant : la navigation peut afficher la rubrique juste après la connexion (/admin#evenement)
  document.addEventListener('admin:section', (e) => {
    const form = document.getElementById('form-evenement');
    if (e.detail.id === 'evenement' && form) charger(form);
  });

  window.Admin.pret.then(() => {
    const form = document.getElementById('form-evenement');
    if (!form) return; // simple admin : rubrique retirée
    const resultat = document.getElementById('resultat-evenement');
    const bouton = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.elements.nom.value.trim()) {
        return erreursFormulaire(form, resultat, { message: "Le nom de l'événement est obligatoire.", errors: [{ champ: 'nom' }] });
      }
      const donnees = new FormData(form);
      if (!form.elements.image_apropos.files.length) donnees.delete('image_apropos'); // garder l'image actuelle

      bouton.disabled = true;
      try {
        const data = await api('/api/admin/evenement', { method: 'PUT', body: donnees });
        remplirFormulaire(form, data.evenement);
        succesFormulaire(form, resultat, data.message);
        notifier('Informations enregistrées');
      } catch (err) {
        erreursFormulaire(form, resultat, err);
      } finally {
        bouton.disabled = false;
      }
    });
  }).catch(() => {});
})();
