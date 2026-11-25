// Rubrique « Galerie des éditions passées » (super-administrateur) :
// GET /api/admin/galerie, POST /api/admin/galerie (photos), DELETE /api/admin/galerie/:id
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
    const zone = $('galerie-admin');
    const etat = $('etat-galerie');
    if (!zone) return;
    try {
      const editions = await api('/api/admin/galerie');
      zone.replaceChildren();
      etat.hidden = editions.length > 0;
      etat.textContent = 'Aucune photo pour le moment. Ajoutez les photos de vos éditions passées avec le formulaire ci-dessus.';

      editions.forEach((ed) => {
        const bloc = element('section', null, 'admin-carte galerie-admin__edition');
        bloc.appendChild(element('h3', `${ed.edition_libelle}${ed.annee ? ` · ${ed.annee}` : ''} (${ed.photos.length} photo${ed.photos.length > 1 ? 's' : ''})`));
        const grille = element('ul', null, 'galerie-admin__grille');
        ed.photos.forEach((p) => {
          const li = element('li', null, 'galerie-admin__photo');
          const img = element('img');
          img.src = p.image;
          img.alt = p.legende || `Photo de la ${ed.edition_libelle}`;
          img.loading = 'lazy';
          li.appendChild(img);
          if (p.legende) li.appendChild(element('p', p.legende, 'galerie-admin__legende'));
          const bouton = element('button', 'Supprimer', 'bouton-petit bouton-petit--danger');
          bouton.type = 'button';
          bouton.addEventListener('click', () => supprimer(p, bouton));
          li.appendChild(bouton);
          grille.appendChild(li);
        });
        bloc.appendChild(grille);
        zone.appendChild(bloc);
      });
    } catch (err) {
      etat.hidden = false;
      etat.textContent = `Impossible de charger la galerie : ${err.message}`;
    }
  }

  async function supprimer(photo, bouton) {
    if (!(await confirmer('Cette photo sera retirée du site. Continuer ?', 'Supprimer la photo'))) return;
    bouton.disabled = true;
    try {
      const data = await api(`/api/admin/galerie/${photo.id}`, { method: 'DELETE' });
      notifier(data.message);
      await charger();
    } catch (err) {
      notifier(err.message, 'erreur');
      bouton.disabled = false;
    }
  }

  document.addEventListener('admin:section', (e) => {
    if (e.detail.id === 'galerie') charger();
  });

  window.Admin.pret.then(() => {
    const form = $('form-galerie');
    if (!form) return;
    const resultat = $('resultat-galerie');
    const bouton = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const manquants = champsManquants(form);
      if (manquants.length) return erreursFormulaire(form, resultat, { message: manquants.map((m) => m.message).join(' · '), errors: manquants });

      bouton.disabled = true;
      bouton.textContent = 'Envoi en cours…';
      try {
        const data = await api('/api/admin/galerie', { method: 'POST', body: new FormData(form) });
        form.elements.photos.value = '';
        form.elements.legende.value = '';
        succesFormulaire(form, resultat, data.message);
        notifier(data.message);
        await charger();
      } catch (err) {
        erreursFormulaire(form, resultat, err);
      } finally {
        bouton.disabled = false;
        bouton.textContent = 'Ajouter à la galerie';
      }
    });
  });
})();
