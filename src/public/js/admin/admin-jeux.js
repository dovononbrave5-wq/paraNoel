// Rubrique « Jeux concours » : créer un jeu (questionnaire PDF, nombre de cases), examiner et noter
// les soumissions des joueurs après la clôture, retenir les finalistes et publier la rencontre en présentiel.
(function () {
  const { api, remplir, notifier, confirmer, erreursFormulaire, succesFormulaire, champsManquants, rafraichirStats } = window.Admin;
  const $ = (id) => document.getElementById(id);
  let jeux = [];
  let jeuParticipants = null; // jeu dont on affiche les soumissions
  let soumissions = [];       // soumissions chargées
  let soumissionOuverte = null;

  /* ---------------------------------------------------------------------
     Liste des jeux
     --------------------------------------------------------------------- */
  async function charger() {
    const tbody = $('tbody-jeux');
    const etat = $('etat-jeux');
    etat.hidden = false;
    etat.textContent = 'Chargement…';
    try {
      jeux = await api('/api/admin/jeux');
      tbody.textContent = '';
      jeux.forEach((j) => {
        const fragment = remplir($('modele-jeu-admin'), j);
        fragment.querySelector('.badge--phase').classList.add(`etat-${j.phase}`);
        fragment.querySelectorAll('[data-action]').forEach((b) => b.setAttribute('aria-label', `${b.textContent} : ${j.titre}`));
        tbody.appendChild(fragment);
      });
      etat.hidden = jeux.length > 0;
      etat.textContent = 'Aucun jeu pour le moment. Cliquez sur « Créer un jeu ».';
    } catch (err) {
      etat.textContent = `Chargement impossible : ${err.message}`;
    }
  }

  /* ---------------------------------------------------------------------
     Créer / modifier un jeu
     --------------------------------------------------------------------- */
  const versChamp = (valeur) => (valeur ? String(valeur).replace(' ', 'T').slice(0, 16) : '');

  function ouvrirJeu(jeu = null) {
    const form = $('form-jeu');
    form.reset();
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    const resultat = form.querySelector('[data-resultat]');
    resultat.textContent = '';
    resultat.className = 'formulaire__resultat';
    form.elements.id.value = jeu ? jeu.id : '';
    $('titre-dialogue-jeu').textContent = jeu ? `Modifier : ${jeu.titre}` : 'Créer un jeu';

    // Formulaire PDF actuel : lien pour le consulter et case pour le retirer
    const aUnPdf = Boolean(jeu && jeu.formulaire_pdf);
    $('jeu-formulaire-actuel').hidden = !aUnPdf;
    $('jeu-formulaire-retirer').hidden = !aUnPdf;
    if (aUnPdf) {
      $('jeu-formulaire-lien').textContent = jeu.formulaire_nom || 'formulaire.pdf';
      $('jeu-formulaire-lien').href = `/api/admin/jeux/${jeu.id}/formulaire`;
    }

    if (jeu) {
      [...form.elements].forEach((el) => {
        if (!el.name || el.name === 'id' || el.name === 'retirer_formulaire' || el.type === 'file' || el.type === 'submit' || el.type === 'button') return;
        const valeur = jeu[el.name];
        if (el.type === 'checkbox') el.checked = Boolean(valeur);
        else if (el.type === 'datetime-local') el.value = versChamp(valeur);
        else el.value = valeur ?? '';
      });
    }
    $('dialogue-jeu').showModal();
    form.elements.titre.focus();
  }

  async function enregistrerJeu(event) {
    event.preventDefault();
    const form = $('form-jeu');
    const resultat = form.querySelector('[data-resultat]');
    const manquants = champsManquants(form);
    if (manquants.length) return erreursFormulaire(form, resultat, { message: manquants.map((m) => m.message).join(' · '), errors: manquants });

    const corps = new FormData(form);
    const id = corps.get('id');
    corps.delete('id');
    if (!form.elements.image.files.length) corps.delete('image'); // garder l'image actuelle
    if (!form.elements.formulaire.files.length) corps.delete('formulaire'); // garder le PDF actuel

    const bouton = form.querySelector('button[type="submit"]');
    bouton.disabled = true;
    try {
      const data = await api(id ? `/api/admin/jeux/${id}` : '/api/admin/jeux', { method: id ? 'PUT' : 'POST', body: corps });
      $('dialogue-jeu').close();
      notifier(data.message);
      await charger();
      rafraichirStats();
    } catch (err) {
      erreursFormulaire(form, resultat, err);
    } finally {
      bouton.disabled = false;
    }
  }

  async function supprimerJeu(jeu) {
    if (!(await confirmer(`Supprimer le jeu « ${jeu.titre} » et ses questions ? Cette action est définitive.`, 'Supprimer'))) return;
    try {
      const data = await api(`/api/admin/jeux/${jeu.id}`, { method: 'DELETE' });
      notifier(data.message);
      charger();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  }

  /* ---------------------------------------------------------------------
     Soumissions : examen, note, retenus / non retenus
     --------------------------------------------------------------------- */
  function resume(p) {
    if (p.statut !== 'terminee') return 'Rien envoyé';
    const cases = p.reponses.filter(Boolean).length;
    const parts = [`${cases} case${cases > 1 ? 's' : ''}`];
    if (p.nb_photos) parts.push(`${p.nb_photos} photo${p.nb_photos > 1 ? 's' : ''}`);
    return parts.join(' · ');
  }

  async function chargerParticipants() {
    const tbody = $('tbody-participants');
    const etat = $('etat-participants');
    etat.hidden = false;
    etat.textContent = 'Chargement…';
    try {
      const data = await api(`/api/admin/jeux/${jeuParticipants.id}/participations`);
      soumissions = data.participations;
      tbody.textContent = '';
      soumissions.forEach((p) => {
        const fragment = remplir($('modele-participant'), { ...p, rang: p.rang ?? '–', resume: resume(p) });
        const tr = fragment.firstElementChild;
        tr.dataset.id = p.id;
        const liste = tr.querySelector('select[data-action="resultat"]');
        liste.value = p.resultat;
        liste.setAttribute('aria-label', `Résultat de ${p.email}`);
        const note = tr.querySelector('input[data-action="note"]');
        note.value = p.note ?? '';
        note.setAttribute('aria-label', `Note de ${p.email}`);
        const examiner = tr.querySelector('[data-action="examiner"]');
        examiner.setAttribute('aria-label', `Examiner la soumission de ${p.email}`);
        if (p.statut !== 'terminee') { examiner.disabled = true; note.disabled = true; }
        tr.classList.add(`resultat-${p.resultat}`);
        tbody.appendChild(fragment);
      });
      etat.hidden = soumissions.length > 0;
      etat.textContent = 'Personne n\'a encore acheté ce questionnaire.';
    } catch (err) {
      etat.textContent = `Chargement impossible : ${err.message}`;
    }
  }

  function ouvrirParticipants(jeu) {
    jeuParticipants = jeu;
    $('participants-jeu-titre').textContent = jeu.titre;
    $('dialogue-participants').showModal();
    chargerParticipants();
  }

  async function enregistrerNote(id, valeur) {
    const note = valeur === '' ? null : Number(valeur);
    const data = await api(`/api/admin/participations/${id}/note`, { method: 'PATCH', body: { note } });
    notifier(data.message);
  }

  function ouvrirSoumission(p) {
    soumissionOuverte = p;
    $('soumission-email').textContent = p.email;
    $('soumission-date').textContent = p.soumis_le ? `Envoyée le ${window.Admin.formatDate(p.soumis_le, true)}` : '';
    const liste = $('soumission-reponses');
    liste.replaceChildren();
    p.reponses.forEach((texte) => {
      const li = document.createElement('li');
      li.textContent = texte || '—';
      if (!texte) li.className = 'soumission__vide';
      liste.appendChild(li);
    });
    const photos = $('soumission-photos');
    photos.replaceChildren();
    for (let n = 1; n <= p.nb_photos; n++) {
      const li = document.createElement('li');
      const lien = document.createElement('a');
      lien.href = `/api/admin/participations/${p.id}/photos/${n}`;
      lien.target = '_blank';
      lien.rel = 'noopener';
      const img = document.createElement('img');
      img.src = lien.href;
      img.alt = `Photo ${n} de ${p.email}`;
      img.loading = 'lazy';
      lien.appendChild(img);
      li.appendChild(lien);
      photos.appendChild(li);
    }
    $('soumission-sans-photo').hidden = p.nb_photos > 0;
    $('soumission-note').value = p.note ?? '';
    $('dialogue-soumission').showModal();
  }

  $('btn-noter').addEventListener('click', async () => {
    if (!soumissionOuverte) return;
    try {
      await enregistrerNote(soumissionOuverte.id, $('soumission-note').value.trim());
      $('dialogue-soumission').close();
      chargerParticipants();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  });

  $('tbody-participants').addEventListener('click', (event) => {
    const bouton = event.target.closest('button[data-action="examiner"]');
    if (!bouton) return;
    const p = soumissions.find((s) => String(s.id) === bouton.closest('tr').dataset.id);
    if (p) ouvrirSoumission(p);
  });

  $('tbody-participants').addEventListener('change', async (event) => {
    const tr = event.target.closest('tr');
    const note = event.target.closest('input[data-action="note"]');
    if (note) {
      try {
        await enregistrerNote(tr.dataset.id, note.value.trim());
      } catch (err) {
        notifier(err.message, 'erreur');
        chargerParticipants();
      }
      return;
    }
    const liste = event.target.closest('select[data-action="resultat"]');
    if (!liste) return;
    try {
      await api(`/api/admin/participations/${tr.dataset.id}`, { method: 'PATCH', body: { resultat: liste.value } });
      tr.className = `resultat-${liste.value}`;
      notifier('Résultat enregistré');
    } catch (err) {
      notifier(err.message, 'erreur');
      chargerParticipants();
    }
  });

  $('form-retenir').addEventListener('submit', async (event) => {
    event.preventDefault();
    const nombre = Number($('retenir-nombre').value);
    if (!(await confirmer(`Retenir les ${nombre} meilleures notes pour la finale ? Les autres soumissions notées seront « non retenues ».`, 'Retenir'))) return;
    try {
      const data = await api(`/api/admin/jeux/${jeuParticipants.id}/retenir`, { method: 'POST', body: { nombre } });
      notifier(data.message);
      chargerParticipants();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  });

  /* ---------------------------------------------------------------------
     Branchements
     --------------------------------------------------------------------- */
  $('btn-ajouter-jeu').addEventListener('click', () => ouvrirJeu());
  $('form-jeu').addEventListener('submit', enregistrerJeu);
  $('tbody-jeux').addEventListener('click', (event) => {
    const bouton = event.target.closest('button[data-action]');
    if (!bouton) return;
    const jeu = jeux.find((j) => String(j.id) === bouton.closest('tr').dataset.id);
    if (!jeu) return;
    if (bouton.dataset.action === 'modifier') ouvrirJeu(jeu);
    if (bouton.dataset.action === 'participants') ouvrirParticipants(jeu);
    if (bouton.dataset.action === 'supprimer') supprimerJeu(jeu);
  });
  document.addEventListener('admin:section', (e) => { if (e.detail.id === 'jeux') charger(); });
})();
