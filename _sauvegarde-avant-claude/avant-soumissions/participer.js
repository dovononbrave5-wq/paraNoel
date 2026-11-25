// Parcours « Participer » : compte → paiement Mobile Money (KKiaPay) → questionnaire chronométré → rencontre.
// Le serveur décide de tout (montant, temps restant, correction) : cette page ne fait qu'afficher et envoyer.
(function () {
  const params = new URLSearchParams(location.search);
  const jeuId = params.get('jeu');
  const $ = (id) => document.getElementById(id);
  const message = $('message-parcours');
  const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const lireDate = (v) => new Date(String(v).replace(' ', 'T'));
  const dateLisible = (v) => (v ? FORMAT_DATE.format(lireDate(v)) : '–');

  let etat = null;       // réponse de /ma-participation : { jeu, participation, paiement }
  let minuterie = null;  // chronomètre du questionnaire
  let envoiEnCours = false;
  const cleBrouillon = `paranoel-reponses-${jeuId}`;

  // --- Petits outils ---
  function afficherMessage(texte, type = 'erreur') {
    message.textContent = texte;
    message.className = `message-parcours message-parcours--${type}`;
    message.hidden = !texte;
    if (texte) message.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || data.errors?.[0]?.message || `Erreur ${res.status}`), { status: res.status });
    return data;
  }

  // Affiche une seule étape et met à jour l'indicateur de progression
  const ORDRE = ['compte', 'paiement', 'questionnaire', 'rencontre'];
  const INDICATEUR = { compte: 'compte', paiement: 'paiement', pret: 'questionnaire', questionnaire: 'questionnaire', termine: 'rencontre', ferme: null };
  function montrerEtape(nom) {
    document.querySelectorAll('[data-etape]').forEach((el) => { el.hidden = el.dataset.etape !== nom; });
    const actuel = ORDRE.indexOf(INDICATEUR[nom]);
    document.querySelectorAll('[data-etape-indicateur]').forEach((li) => {
      const position = ORDRE.indexOf(li.dataset.etapeIndicateur);
      li.classList.toggle('progression--fait', actuel > position);
      if (position === actuel) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    document.querySelector('.progression').hidden = nom === 'ferme';
  }

  // --- Présentation du jeu ---
  function afficherJeu(jeu) {
    $('parcours').hidden = false;
    $('parcours-titre').textContent = jeu.titre;
    $('parcours-description').textContent = jeu.description;
    $('parcours-prix').textContent = jeu.prix_libelle;
    $('parcours-questions').textContent = String(jeu.nb_questions);
    $('parcours-duree').textContent = `${jeu.duree_minutes} min`;
    $('parcours-cloture').textContent = dateLisible(jeu.date_cloture);
    const phase = $('parcours-phase');
    phase.textContent = jeu.phase_libelle;
    phase.classList.add(`etat-${jeu.phase}`);
    document.title = `${jeu.titre} | Participer | Para'Noel`;
    $('btn-payer').textContent = `Payer ${jeu.prix_libelle}`;
    if (jeu.reglement) {
      $('reglement-bloc').hidden = false;
      $('reglement-texte').textContent = jeu.reglement;
    }
    $('pret-duree').textContent = `${jeu.duree_minutes} minute${jeu.duree_minutes > 1 ? 's' : ''}`;
    $('pret-questions').textContent = `${jeu.nb_questions} question${jeu.nb_questions > 1 ? 's' : ''}`;
  }

  function afficherFin(participation, jeu) {
    $('termine-resultat').textContent = participation?.resultat_libelle || 'En attente';
    if (jeu.rencontre_date) {
      $('termine-rencontre').hidden = false;
      $('rencontre-date').textContent = dateLisible(jeu.rencontre_date);
      $('rencontre-lieu').textContent = jeu.rencontre_lieu || '';
      $('rencontre-infos').textContent = jeu.rencontre_infos || '';
    }
    montrerEtape('termine');
  }

  // Choisit l'étape d'après l'état renvoyé par le serveur
  function aiguiller() {
    const { jeu, participation } = etat;
    if (!participation) {
      if (jeu.phase !== 'ouvert') {
        $('ferme-message').textContent = jeu.phase === 'a-venir'
          ? `Ce questionnaire ouvrira le ${dateLisible(jeu.date_ouverture)}. Reviens à ce moment-là !`
          : 'Ce questionnaire est clôturé. Consulte les annonces pour la suite.';
        return montrerEtape('ferme');
      }
      return montrerEtape('paiement');
    }
    if (participation.statut === 'payee') {
      if (jeu.phase !== 'ouvert') {
        $('ferme-message').textContent = 'Le questionnaire est clôturé. Contacte l\'organisation depuis la page Contact.';
        return montrerEtape('ferme');
      }
      return montrerEtape('pret');
    }
    if (participation.statut === 'en_cours') return chargerQuestionnaire();
    return afficherFin(participation, jeu);
  }

  /* ---------------------------------------------------------------------
     Paiement
     --------------------------------------------------------------------- */
  // Charge le script de KKiaPay une seule fois, et seulement sur cette page
  function chargerKkiapay() {
    if (window.openKkiapayWidget) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.kkiapay.me/k.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Le module de paiement KKiaPay ne se charge pas. Vérifie ta connexion.'));
      document.body.appendChild(script);
    });
  }

  async function confirmer(reference, transactionId) {
    afficherMessage('Vérification du paiement…', 'info');
    try {
      await api(`/api/jeux/${jeuId}/paiement/confirmer`, { method: 'POST', body: { reference, transactionId } });
      afficherMessage('', 'info');
      await rafraichir();
    } catch (err) {
      afficherMessage(err.message);
      $('btn-payer').disabled = false;
    }
  }

  async function payer() {
    if (!$('accepte-reglement').checked) {
      $('accepte-reglement').setAttribute('aria-invalid', 'true');
      $('accepte-reglement').focus();
      return afficherMessage('Coche la case pour accepter le règlement avant de payer.');
    }
    $('accepte-reglement').removeAttribute('aria-invalid');
    $('btn-payer').disabled = true;
    afficherMessage('', 'info');

    let paiement;
    try {
      paiement = await api(`/api/jeux/${jeuId}/paiement`, { method: 'POST' });
    } catch (err) {
      $('btn-payer').disabled = false;
      if (err.status === 409) await rafraichir();
      return afficherMessage(err.message);
    }

    // Mode test : fenêtre simulée, aucun argent débité
    if (paiement.mode === 'simulation') {
      const dialogue = $('dialogue-simulation');
      dialogue.returnValue = 'non';
      dialogue.addEventListener('close', () => {
        if (dialogue.returnValue === 'oui') confirmer(paiement.reference, 'simulation');
        else { $('btn-payer').disabled = false; afficherMessage('Paiement annulé.', 'info'); }
      }, { once: true });
      return dialogue.showModal();
    }

    // KKiaPay : fenêtre officielle (MTN, Moov, Celtiis). Le montant et la référence viennent du serveur.
    try {
      await chargerKkiapay();
    } catch (err) {
      $('btn-payer').disabled = false;
      return afficherMessage(err.message);
    }
    window.addSuccessListener((reponse) => confirmer(paiement.reference, reponse.transactionId));
    if (typeof window.addFailedListener === 'function') {
      window.addFailedListener(() => {
        $('btn-payer').disabled = false;
        afficherMessage('Le paiement n\'a pas abouti. Tu n\'as pas été débité : réessaie quand tu veux.');
      });
    }
    window.openKkiapayWidget({
      amount: paiement.montant,
      key: paiement.cle_publique,
      sandbox: paiement.sandbox,
      partnerId: paiement.reference,
      email: paiement.email,
      paymentmethod: 'momo',
      countries: ['BJ'],
      position: 'center',
      theme: '#c8102e'
    });
    $('btn-payer').disabled = false;
  }

  /* ---------------------------------------------------------------------
     Questionnaire
     --------------------------------------------------------------------- */
  function lireBrouillon() {
    try { return JSON.parse(localStorage.getItem(cleBrouillon)) || {}; } catch { return {}; }
  }
  function ecrireBrouillon(reponses) {
    try { localStorage.setItem(cleBrouillon, JSON.stringify(reponses)); } catch { /* stockage indisponible : sans effet */ }
  }
  function effacerBrouillon() {
    try { localStorage.removeItem(cleBrouillon); } catch { /* sans effet */ }
  }

  function reponsesCochees() {
    const reponses = {};
    $('formulaire-questionnaire').querySelectorAll('input[type="radio"]:checked').forEach((r) => {
      reponses[r.dataset.question] = Number(r.value);
    });
    return reponses;
  }

  function majProgres() {
    const total = $('liste-questions').children.length;
    const repondu = Object.keys(reponsesCochees()).length;
    $('chrono-repondu').textContent = String(repondu);
    $('chrono-total').textContent = String(total);
  }

  function construireQuestions(questions) {
    const liste = $('liste-questions');
    const modele = $('modele-question');
    const brouillon = lireBrouillon();
    liste.textContent = '';
    questions.forEach((q, i) => {
      const fragment = modele.content.cloneNode(true);
      fragment.querySelector('.question__intitule').textContent = `${i + 1}. ${q.intitule}`;
      const zone = fragment.querySelector('.question__choix');
      q.choix.forEach((texte, position) => {
        const id = `q${q.id}-c${position}`;
        const ligne = document.createElement('div');
        ligne.className = 'choix';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `q${q.id}`;
        radio.id = id;
        radio.value = String(position);
        radio.dataset.question = String(q.id);
        radio.checked = brouillon[q.id] === position;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = texte;
        ligne.append(radio, label);
        zone.appendChild(ligne);
      });
      liste.appendChild(fragment);
    });
    majProgres();
  }

  function demarrerChrono(secondes, total) {
    const fin = Date.now() + secondes * 1000;
    const duree = total * 1000;
    clearInterval(minuterie);
    function tic() {
      const reste = Math.max(0, Math.round((fin - Date.now()) / 1000));
      $('chrono-temps').textContent = `${String(Math.floor(reste / 60)).padStart(2, '0')}:${String(reste % 60).padStart(2, '0')}`;
      $('chrono-barre').style.width = `${Math.max(0, Math.min(100, ((fin - Date.now()) / duree) * 100))}%`;
      $('chrono').classList.toggle('chrono--urgent', reste <= 60);
      if (reste === 0) {
        clearInterval(minuterie);
        envoyer(true);
      }
    }
    tic();
    minuterie = setInterval(tic, 500);
  }

  async function chargerQuestionnaire() {
    try {
      const donnees = await api(`/api/jeux/${jeuId}/questionnaire`);
      construireQuestions(donnees.questions);
      montrerEtape('questionnaire');
      demarrerChrono(donnees.secondes_restantes, etat.jeu.duree_minutes * 60);
    } catch (err) {
      afficherMessage(err.message);
      await rafraichir(false);
    }
  }

  async function commencer() {
    $('btn-commencer').disabled = true;
    try {
      await api(`/api/jeux/${jeuId}/demarrer`, { method: 'POST' });
      await rafraichir();
    } catch (err) {
      afficherMessage(err.message);
    } finally {
      $('btn-commencer').disabled = false;
    }
  }

  // Confirmation s'il reste des questions sans réponse (sauf envoi automatique à la fin du temps)
  function confirmerEnvoi(manquantes) {
    return new Promise((resolve) => {
      const dialogue = $('dialogue-envoi');
      $('texte-envoi').textContent = `${manquantes} question${manquantes > 1 ? 's restent' : ' reste'} sans réponse. Une fois envoyées, tes réponses ne peuvent plus être modifiées.`;
      dialogue.returnValue = 'non';
      dialogue.addEventListener('close', () => resolve(dialogue.returnValue === 'oui'), { once: true });
      dialogue.showModal();
    });
  }

  async function envoyer(automatique = false) {
    if (envoiEnCours) return;
    const reponses = reponsesCochees();
    const manquantes = $('liste-questions').children.length - Object.keys(reponses).length;
    if (!automatique && manquantes > 0 && !(await confirmerEnvoi(manquantes))) return;

    envoiEnCours = true;
    clearInterval(minuterie);
    $('btn-envoyer').disabled = true;
    try {
      const resultat = await api(`/api/jeux/${jeuId}/reponses`, { method: 'POST', body: { reponses } });
      effacerBrouillon();
      $('termine-message').textContent = resultat.message;
      await rafraichir();
    } catch (err) {
      afficherMessage(err.message);
      await rafraichir(false);
    } finally {
      envoiEnCours = false;
      $('btn-envoyer').disabled = false;
    }
  }

  /* ---------------------------------------------------------------------
     Démarrage de la page
     --------------------------------------------------------------------- */
  async function rafraichir(effacerMessage = true) {
    try {
      // Visiteur non connecté : pas d'appel à l'API privée (évite une erreur 401 inutile)
      const session = await api('/api/public/session');
      if (!session.connecte) throw Object.assign(new Error('Non connecté'), { status: 401 });
      etat = await api(`/api/jeux/${jeuId}/ma-participation`);
      afficherJeu(etat.jeu);
      if (effacerMessage) afficherMessage('', 'info');
      aiguiller();
    } catch (err) {
      if (err.status === 401) {
        // Non connecté : on montre le jeu (version publique) et l'étape « compte »
        try {
          const jeu = await api(`/api/public/jeux/${jeuId}`);
          etat = { jeu, participation: null };
          afficherJeu(jeu);
          const retour = `/participer?jeu=${encodeURIComponent(jeuId)}`;
          $('lien-connexion').href = `/login?retour=${encodeURIComponent(retour)}`;
          if (jeu.phase !== 'ouvert') return aiguiller();
          return montrerEtape('compte');
        } catch (e) {
          return afficherMessage(e.message);
        }
      }
      afficherMessage(err.status === 404 ? 'Ce jeu n\'existe pas ou n\'est plus en ligne.' : err.message);
    }
  }

  if (!jeuId) {
    $('choix-jeu').hidden = false;
    const liste = document.querySelector('#choix-jeu .liste-dynamique');
    if (window.listesDynamiques) window.listesDynamiques.charger(liste);
    return;
  }

  $('btn-payer').addEventListener('click', payer);
  $('btn-commencer').addEventListener('click', commencer);
  $('formulaire-questionnaire').addEventListener('change', () => {
    ecrireBrouillon(reponsesCochees());
    majProgres();
  });
  $('formulaire-questionnaire').addEventListener('submit', (event) => {
    event.preventDefault();
    envoyer(false);
  });
  rafraichir();
})();
