// Rubrique « Jeux concours » : créer un jeu, écrire ses questions, suivre le classement des participants,
// désigner les retenus et publier la rencontre en présentiel.
(function () {
  const { api, remplir, notifier, confirmer, erreursFormulaire, succesFormulaire, champsManquants, rafraichirStats } = window.Admin;
  const $ = (id) => document.getElementById(id);
  const MAX_CHOIX = 6;
  let jeux = [];
  let jeuQuestions = null;    // jeu dont on édite les questions
  let jeuParticipants = null; // jeu dont on affiche les participants
  let compteurGroupe = 0;     // pour des noms de boutons radio uniques

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
      // Nouveau jeu : on enchaîne directement sur ses questions
      if (!id && data.element) ouvrirQuestions(data.element);
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
     Éditeur des questions
     --------------------------------------------------------------------- */
  function numeroter() {
    [...$('liste-questions-admin').children].forEach((li, i) => {
      li.querySelector('.question-admin__numero').textContent = `Question ${i + 1}`;
      li.querySelector('[data-q="intitule"]').setAttribute('aria-label', `Intitulé de la question ${i + 1}`);
      li.querySelectorAll('.choix-admin').forEach((ligne, j) => {
        ligne.querySelector('[data-q="bonne"]').setAttribute('aria-label', `Question ${i + 1} : la réponse ${j + 1} est la bonne`);
        ligne.querySelector('[data-q="choix"]').setAttribute('aria-label', `Question ${i + 1}, réponse ${j + 1}`);
      });
    });
  }

  function ajouterChoix(li, texte = '', coche = false) {
    const zone = li.querySelector('.question-admin__choix');
    if (zone.children.length >= MAX_CHOIX) return notifier(`${MAX_CHOIX} réponses au maximum par question`, 'erreur');
    const ligne = $('modele-choix-admin').content.cloneNode(true).firstElementChild;
    const radio = ligne.querySelector('[data-q="bonne"]');
    radio.name = li.dataset.groupe;
    radio.checked = coche;
    ligne.querySelector('[data-q="choix"]').value = texte;
    zone.appendChild(ligne);
    numeroter();
    return ligne;
  }

  function ajouterQuestion(q = null) {
    const li = $('modele-question-admin').content.cloneNode(true).firstElementChild;
    li.dataset.groupe = `bonne-${++compteurGroupe}`;
    li.querySelector('[data-q="intitule"]').value = q?.intitule || '';
    li.querySelector('[data-q="points"]').value = q?.points || 1;
    $('liste-questions-admin').appendChild(li);
    const choix = q?.choix?.length ? q.choix : ['', ''];
    choix.forEach((texte, i) => ajouterChoix(li, texte, q ? q.bonne_reponse === i : false));
    numeroter();
    return li;
  }

  function verrouiller(verrou) {
    $('questions-verrou').hidden = !verrou;
    $('form-questions').querySelectorAll('input, textarea, [data-action="ajouter-choix"], [data-action="retirer-choix"], [data-action="retirer-question"]').forEach((el) => { el.disabled = verrou; });
    $('btn-ajouter-question').hidden = verrou;
    $('btn-enregistrer-questions').hidden = verrou;
  }

  async function ouvrirQuestions(jeu) {
    jeuQuestions = jeu;
    $('questions-jeu-titre').textContent = jeu.titre;
    $('liste-questions-admin').textContent = '';
    const resultat = $('resultat-questions');
    resultat.textContent = '';
    resultat.className = 'formulaire__resultat';
    $('dialogue-questions').showModal();
    try {
      const data = await api(`/api/admin/jeux/${jeu.id}/questions`);
      if (data.questions.length) data.questions.forEach(ajouterQuestion);
      else ajouterQuestion();
      verrouiller(data.verrouille);
    } catch (err) {
      erreursFormulaire($('form-questions'), resultat, err);
    }
  }

  // Lit l'éditeur et vérifie l'essentiel avant l'envoi (le serveur revérifie tout)
  function lireQuestions() {
    const erreurs = [];
    const questions = [...$('liste-questions-admin').children].map((li, i) => {
      li.classList.remove('question-admin--erreur');
      const lignes = [...li.querySelectorAll('.choix-admin')].filter((l) => l.querySelector('[data-q="choix"]').value.trim());
      const question = {
        intitule: li.querySelector('[data-q="intitule"]').value.trim(),
        choix: lignes.map((l) => l.querySelector('[data-q="choix"]').value.trim()),
        bonne_reponse: lignes.findIndex((l) => l.querySelector('[data-q="bonne"]').checked),
        points: Number(li.querySelector('[data-q="points"]').value) || 1
      };
      const probleme = !question.intitule ? 'intitulé manquant'
        : question.choix.length < 2 ? 'au moins 2 réponses'
          : question.bonne_reponse < 0 ? 'cochez la bonne réponse' : null;
      if (probleme) {
        li.classList.add('question-admin--erreur');
        erreurs.push({ champ: `q${i + 1}`, message: `Question ${i + 1} : ${probleme}` });
      }
      return question;
    });
    if (!questions.length) erreurs.push({ champ: 'questions', message: 'Ajoutez au moins une question' });
    return { questions, erreurs };
  }

  async function enregistrerQuestions(event) {
    event.preventDefault();
    const resultat = $('resultat-questions');
    const { questions, erreurs } = lireQuestions();
    if (erreurs.length) return erreursFormulaire($('form-questions'), resultat, { message: erreurs.map((e) => e.message).join(' · '), errors: [] });

    const bouton = $('btn-enregistrer-questions');
    bouton.disabled = true;
    try {
      const data = await api(`/api/admin/jeux/${jeuQuestions.id}/questions`, { method: 'PUT', body: { questions } });
      succesFormulaire($('form-questions'), resultat, data.message);
      notifier(data.message);
      charger();
    } catch (err) {
      // Le serveur signale « q3 » : on encadre la question concernée
      (err.errors || []).forEach((e) => {
        const n = /^q(\d+)$/.exec(e.champ || '');
        if (n) $('liste-questions-admin').children[Number(n[1]) - 1]?.classList.add('question-admin--erreur');
      });
      erreursFormulaire($('form-questions'), resultat, err);
    } finally {
      bouton.disabled = false;
    }
  }

  $('form-questions').addEventListener('click', async (event) => {
    const bouton = event.target.closest('button[data-action]');
    if (!bouton) return;
    const li = bouton.closest('.question-admin');
    if (bouton.dataset.action === 'ajouter-choix') ajouterChoix(li).querySelector('[data-q="choix"]').focus();
    if (bouton.dataset.action === 'retirer-choix') {
      if (li.querySelectorAll('.choix-admin').length <= 2) return notifier('Une question garde au moins 2 réponses', 'erreur');
      bouton.closest('.choix-admin').remove();
      numeroter();
    }
    if (bouton.dataset.action === 'retirer-question') {
      if (li.querySelector('[data-q="intitule"]').value.trim() && !(await confirmer('Retirer cette question ?', 'Retirer'))) return;
      li.remove();
      numeroter();
    }
  });
  $('btn-ajouter-question').addEventListener('click', () => ajouterQuestion().querySelector('[data-q="intitule"]').focus());
  $('form-questions').addEventListener('submit', enregistrerQuestions);

  /* ---------------------------------------------------------------------
     Participants : classement, retenus / non retenus
     --------------------------------------------------------------------- */
  async function chargerParticipants() {
    const tbody = $('tbody-participants');
    const etat = $('etat-participants');
    etat.hidden = false;
    etat.textContent = 'Chargement…';
    try {
      const data = await api(`/api/admin/jeux/${jeuParticipants.id}/participations`);
      tbody.textContent = '';
      data.participations.forEach((p) => {
        const fragment = remplir($('modele-participant'), p);
        const tr = fragment.firstElementChild;
        const liste = tr.querySelector('select[data-action="resultat"]');
        liste.value = p.resultat;
        liste.setAttribute('aria-label', `Résultat de ${p.email}`);
        tr.classList.add(`resultat-${p.resultat}`);
        tbody.appendChild(fragment);
      });
      etat.hidden = data.participations.length > 0;
      etat.textContent = 'Personne n\'a encore payé pour ce jeu.';
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

  $('tbody-participants').addEventListener('change', async (event) => {
    const liste = event.target.closest('select[data-action="resultat"]');
    if (!liste) return;
    const tr = liste.closest('tr');
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
    if (!(await confirmer(`Retenir les ${nombre} premiers du classement ? Les autres participants ayant terminé seront « non retenus ».`, 'Retenir'))) return;
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
    if (bouton.dataset.action === 'questions') ouvrirQuestions(jeu);
    if (bouton.dataset.action === 'participants') ouvrirParticipants(jeu);
    if (bouton.dataset.action === 'supprimer') supprimerJeu(jeu);
  });
  document.addEventListener('admin:section', (e) => { if (e.detail.id === 'jeux') charger(); });
})();
