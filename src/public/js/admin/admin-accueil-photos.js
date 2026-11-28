// Bloc « Photos de l'accueil » (rubrique Informations de l'événement, super-administrateur) :
// GET /api/admin/accueil-photos, POST (plusieurs photos), DELETE /api/admin/accueil-photos/:id
(function () {
  const { api, notifier, confirmer, erreursFormulaire, succesFormulaire, champsManquants } = window.Admin;
  const $ = (id) => document.getElementById(id);

  function element(balise, texte, classe) {
    const el = document.createElement(balise);
    if (texte) el.textContent = texte;
    if (classe) el.className = classe;
    return el;
  }

  async function charger() {
    const zone = $('accueil-photos-liste');
    const etat = $('etat-accueil-photos');
    if (!zone) return;
    try {
      const photos = await api('/api/admin/accueil-photos');
      zone.replaceChildren();
      etat.hidden = photos.length > 0;
      etat.textContent = "Aucune photo pour le moment : l'image par défaut s'affiche sur le site.";
      if (!photos.length) return;

      zone.appendChild(element('h4', `${photos.length} photo${photos.length > 1 ? 's' : ''} dans le diaporama`));
      const grille = element('ul', null, 'galerie-admin__grille');
      photos.forEach((p) => {
        const li = element('li', null, 'galerie-admin__photo');
        const img = element('img');
        img.src = p.image;
        img.alt = p.legende || "Photo de l'accueil";
        img.loading = 'lazy';
        li.appendChild(img);
        if (p.legende) li.appendChild(element('p', p.legende, 'galerie-admin__legende'));
        const bouton = element('button', 'Supprimer', 'bouton-petit bouton-petit--danger');
        bouton.type = 'button';
        bouton.addEventListener('click', () => supprimer(p, bouton));
        li.appendChild(bouton);
        grille.appendChild(li);
      });
      zone.appendChild(grille);
    } catch (err) {
      etat.hidden = false;
      etat.textContent = `Impossible de charger les photos : ${err.message}`;
    }
  }

  async function supprimer(photo, bouton) {
    if (!(await confirmer("Cette photo sera retirée de l'accueil. Continuer ?", 'Supprimer la photo'))) return;
    bouton.disabled = true;
    try {
      const data = await api(`/api/admin/accueil-photos/${photo.id}`, { method: 'DELETE' });
      notifier(data.message);
      await charger();
    } catch (err) {
      notifier(err.message, 'erreur');
      bouton.disabled = false;
    }
  }

  document.addEventListener('admin:section', (e) => {
    if (e.detail.id === 'evenement') charger();
  });

  window.Admin.pret.then(() => {
    const form = $('form-accueil-photos');
    if (!form) return;
    const resultat = $('resultat-accueil-photos');
    const bouton = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const manquants = champsManquants(form);
      if (manquants.length) return erreursFormulaire(form, resultat, { message: manquants.map((m) => m.message).join(' · '), errors: manquants });

      bouton.disabled = true;
      bouton.textContent = 'Envoi en cours…';
      try {
        const data = await api('/api/admin/accueil-photos', { method: 'POST', body: new FormData(form) });
        form.elements.photos.value = '';
        form.elements.legende.value = '';
        succesFormulaire(form, resultat, data.message);
        notifier(data.message);
        await charger();
      } catch (err) {
        erreursFormulaire(form, resultat, err);
      } finally {
        bouton.disabled = false;
        bouton.textContent = 'Ajouter les photos';
      }
    });
  }).catch(() => {});
})();