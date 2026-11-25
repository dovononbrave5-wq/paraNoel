// Rubriques de contenu simples (aujourd'hui : les annonces).
// Un seul script pour les cinq : chaque <section data-ressource data-api> contient
//   - un tableau <tbody data-liste> rempli avec <template data-modele-ligne>
//   - une boîte <dialog> avec le formulaire [data-formulaire] (id vide = création, rempli = modification)
// GET {api} → liste ; POST {api} → ajout ; PUT {api}/{id} → modification ; DELETE {api}/{id} → suppression
(function () {
  const { api, remplir, notifier, confirmer, erreursFormulaire, champsManquants, rafraichirStats } = window.Admin;
  const donnees = {}; // dernière liste chargée, par rubrique (pour remplir le formulaire de modification)

  function etat(section, nom) {
    section.querySelectorAll('[data-etat]').forEach((el) => { el.hidden = el.dataset.etat !== nom; });
  }

  async function charger(section) {
    const ressource = section.dataset.ressource;
    const tbody = section.querySelector('[data-liste]');
    etat(section, 'chargement');
    try {
      const liste = await api(section.dataset.api);
      donnees[ressource] = liste;
      tbody.textContent = '';
      const modele = section.querySelector('template[data-modele-ligne]');
      liste.forEach((item) => {
        const fragment = remplir(modele, item);
        const titre = item.titre || item.nom || '';
        fragment.querySelectorAll('[data-action]').forEach((b) => b.setAttribute('aria-label', `${b.textContent} : ${titre}`));
        tbody.appendChild(fragment);
      });
      etat(section, liste.length ? null : 'vide');
    } catch (err) {
      etat(section, 'erreur');
      const zone = section.querySelector('[data-etat="erreur"]');
      if (zone) zone.textContent = `Chargement impossible : ${err.message}`;
    }
  }

  // Ouvre la boîte de dialogue, vide (ajout) ou remplie avec l'élément (modification)
  function ouvrir(section, item = null) {
    const dialogue = section.querySelector('dialog');
    const form = dialogue.querySelector('[data-formulaire]');
    const titre = dialogue.querySelector('h3');
    form.reset();
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    const resultat = form.querySelector('[data-resultat]');
    resultat.textContent = '';
    resultat.className = 'formulaire__resultat';
    form.elements.id.value = item ? item.id : '';

    if (item) {
      [...form.elements].forEach((el) => {
        if (!el.name || el.name === 'id' || el.type === 'file' || el.type === 'submit' || el.type === 'button') return;
        const valeur = item[el.name];
        if (el.type === 'checkbox') el.checked = Boolean(valeur);
        else if (el.type === 'date') el.value = valeur ? String(valeur).slice(0, 10) : '';
        else el.value = valeur ?? '';
      });
      titre.textContent = `${titre.dataset.titreModification} : ${item.titre || item.nom}`;
    } else {
      titre.textContent = titre.dataset.titreCreation;
      // Nouvelle annonce : publiée aujourd'hui par défaut
      const datePublication = form.elements.date_publication;
      if (datePublication) datePublication.value = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ local
    }
    dialogue.showModal();
    form.querySelector('input:not([type="hidden"]), select, textarea')?.focus();
  }

  async function enregistrer(section, form) {
    const resultat = form.querySelector('[data-resultat]');
    const manquants = champsManquants(form);
    if (manquants.length) {
      return erreursFormulaire(form, resultat, { message: manquants.map((m) => m.message).join(' · '), errors: manquants });
    }

    const corps = new FormData(form);
    const id = corps.get('id');
    corps.delete('id');
    // Pas de nouveau fichier choisi : on n'envoie rien, le serveur garde l'image actuelle
    form.querySelectorAll('input[type="file"]').forEach((el) => { if (!el.files.length) corps.delete(el.name); });

    const bouton = form.querySelector('[data-action="enregistrer"]');
    bouton.disabled = true;
    try {
      const data = await api(id ? `${section.dataset.api}/${id}` : section.dataset.api, { method: id ? 'PUT' : 'POST', body: corps });
      form.closest('dialog').close();
      notifier(data.message);
      charger(section);
    } catch (err) {
      erreursFormulaire(form, resultat, err);
    } finally {
      bouton.disabled = false;
    }
  }

  async function supprimer(section, item) {
    const nom = item.titre || item.nom;
    if (!(await confirmer(`Supprimer « ${nom} » ? Cette action est définitive.`, 'Supprimer'))) return;
    try {
      const data = await api(`${section.dataset.api}/${item.id}`, { method: 'DELETE' });
      notifier(data.message);
      charger(section);
      rafraichirStats();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  }

  function brancher(section) {
    const ressource = section.dataset.ressource;
    const trouver = (id) => (donnees[ressource] || []).find((x) => String(x.id) === String(id));

    section.querySelector('.admin-section__entete [data-action="ajouter"]').addEventListener('click', () => ouvrir(section));

    section.querySelector('[data-liste]').addEventListener('click', (event) => {
      const bouton = event.target.closest('button[data-action]');
      if (!bouton) return;
      const item = trouver(bouton.closest('tr').dataset.id);
      if (!item) return;
      if (bouton.dataset.action === 'modifier') ouvrir(section, item);
      if (bouton.dataset.action === 'supprimer') supprimer(section, item);
    });

    // method="dialog" fermerait la boîte tout de suite : on garde la main pour vérifier et envoyer
    const form = section.querySelector('[data-formulaire]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      enregistrer(section, form);
    });
  }

  document.querySelectorAll('[data-ressource]').forEach(brancher);

  document.addEventListener('admin:section', (e) => {
    const section = document.getElementById(e.detail.id);
    if (section?.dataset.ressource) charger(section);
  });
})();
