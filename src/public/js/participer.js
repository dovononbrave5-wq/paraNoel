// Parcours « Participer » : compte → paiement Mobile Money (KKiaPay) → questionnaire PDF et envoi des réponses → finale.
// Le serveur décide de tout (montant, dates, accès au PDF) : cette page ne fait qu'afficher et envoyer.
(function () {
  const params = new URLSearchParams(location.search);
  const jeuId = params.get('jeu');
  const $ = (id) => document.getElementById(id);
  const message = $('message-parcours');
  const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const lireDate = (v) => new Date(String(v).replace(' ', 'T'));
  const dateLisible = (v) => (v ? FORMAT_DATE.format(lireDate(v)) : '–');

  let etat = null;       // réponse de /ma-participation : { jeu, participation, paiement }
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
  const ORDRE = ['compte', 'paiement', 'reponses', 'finale'];
  const INDICATEUR = { compte: 'compte', paiement: 'paiement', reponses: 'reponses', termine: 'finale', ferme: null };
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
    $('parcours-cases').textContent = String(jeu.nb_reponses);
    $('parcours-cloture').textContent = dateLisible(jeu.date_cloture);
    $('reponses-cloture').textContent = dateLisible(jeu.date_cloture);
    const phase = $('parcours-phase');
    phase.textContent = jeu.phase_libelle;
    phase.classList.add(`etat-${jeu.phase}`);
    document.title = `${jeu.titre} | Participer | Para'Noel`;
    $('btn-payer').textContent = `Payer ${jeu.prix_libelle}`;
    if (jeu.reglement) {
      $('reglement-bloc').hidden = false;
      $('reglement-texte').textContent = jeu.reglement;
    }
  }

  function afficherFin(participation, jeu) {
    $('termine-resultat').textContent = participation?.resultat_libelle || 'En attente';
    // Récapitulatif des réponses envoyées
    const recap = $('recap-reponses');
    recap.replaceChildren();
    (participation?.reponses || []).forEach((texte, i) => {
      const li = document.createElement('li');
      li.textContent = texte || '—';
      li.value = i + 1;
      recap.appendChild(li);
    });
    const nbPhotos = participation?.nb_photos || 0;
    $('recap-photos').textContent = nbPhotos ? `${nbPhotos} photo${nbPhotos > 1 ? 's' : ''} envoyée${nbPhotos > 1 ? 's' : ''}.` : '';
    $('termine-recap').hidden = !participation?.soumis_le;
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
    // Avant la clôture : envoi ou modification des réponses
    if (jeu.phase === 'ouvert') return afficherFormulaire(participation, jeu);
    if (participation.statut !== 'terminee') {
      $('ferme-message').textContent = 'La date de clôture est passée et aucune réponse n\'a été envoyée. Contacte l\'organisation depuis la page Contact.';
      return montrerEtape('ferme');
    }
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
     Questionnaire PDF et envoi des réponses
     --------------------------------------------------------------------- */
  const alerteReponses = (texte, type, options) => window.Alerte.afficher($('reponses-statut'), texte, type, options);

  // Brouillon des cases enregistré dans le navigateur (au cas où la page se ferme avant l'envoi)
  function lireBrouillon() {
    try { return JSON.parse(localStorage.getItem(cleBrouillon)) || null; } catch { return null; }
  }
  function ecrireBrouillon() {
    const valeurs = [...$('cases-reponses').querySelectorAll('textarea')].map((t) => t.value);
    try { localStorage.setItem(cleBrouillon, JSON.stringify(valeurs)); } catch { /* stockage indisponible */ }
  }
  function effacerBrouillon() {
    try { localStorage.removeItem(cleBrouillon); } catch { /* sans effet */ }
  }

  function construireCases(nombre, valeurs) {
    const liste = $('cases-reponses');
    liste.replaceChildren();
    for (let n = 1; n <= nombre; n++) {
      const li = document.createElement('li');
      li.className = 'case-reponse';
      const label = document.createElement('label');
      label.htmlFor = `reponse-${n}`;
      label.textContent = `Réponse ${n}`;
      const zone = document.createElement('textarea');
      zone.id = `reponse-${n}`;
      zone.name = `reponse_${n}`;
      zone.rows = 2;
      zone.maxLength = 1000;
      zone.value = valeurs[n - 1] || '';
      li.append(label, zone);
      liste.appendChild(li);
    }
  }

  function afficherMesPhotos(nombre) {
    const liste = $('mes-photos');
    liste.replaceChildren();
    for (let n = 1; n <= nombre; n++) {
      const li = document.createElement('li');
      const lien = document.createElement('a');
      lien.href = `/api/jeux/${jeuId}/mes-photos/${n}`;
      lien.target = '_blank';
      lien.rel = 'noopener';
      const img = document.createElement('img');
      img.src = lien.href;
      img.alt = `Photo ${n} de mes réponses`;
      img.loading = 'lazy';
      lien.appendChild(img);
      li.appendChild(lien);
      liste.appendChild(li);
    }
    liste.hidden = nombre === 0;
    $('bloc-retirer-photos').hidden = nombre === 0;
    $('retirer-photos').checked = false;
    $('label-photos').textContent = nombre ? 'Remplacer par de nouvelles photos' : 'Ajouter des photos';
  }

  function afficherFormulaire(participation, jeu) {
    $('lien-pdf').href = `/api/jeux/${jeuId}/formulaire`;
    const dejaEnvoye = participation.statut === 'terminee';
    // Les réponses du serveur priment ; sinon le brouillon local
    const valeurs = dejaEnvoye ? participation.reponses : (lireBrouillon() || []);
    construireCases(jeu.nb_reponses, valeurs);
    afficherMesPhotos(participation.nb_photos || 0);
    $('photos-reponses').value = '';
    $('btn-envoyer').textContent = dejaEnvoye ? 'Mettre à jour mes réponses' : 'Envoyer mes réponses';

    if (dejaEnvoye) {
      alerteReponses(`Tes réponses ont bien été reçues le ${dateLisible(participation.soumis_le)}. Tu peux encore les modifier jusqu'au ${dateLisible(jeu.date_cloture)}.`,
        'succes', { titre: 'Réponses envoyées' });
    } else {
      alerteReponses(`Paiement confirmé. Télécharge le questionnaire, puis envoie tes réponses avant le ${dateLisible(jeu.date_cloture)}.`,
        'info', { titre: 'À toi de jouer !' });
    }
    montrerEtape('reponses');
  }

  async function envoyerReponses(event) {
    event.preventDefault();
    if (envoiEnCours) return;
    const form = $('form-reponses');
    const photos = $('photos-reponses').files;
    const casesRemplies = [...form.querySelectorAll('textarea')].some((t) => t.value.trim());
    const garderPhotos = (etat.participation?.nb_photos || 0) > 0 && !$('retirer-photos').checked;

    if (!casesRemplies && !photos.length && !garderPhotos) {
      return alerteReponses('Remplis au moins une case ou ajoute une photo de tes réponses.', 'avertissement', { titre: 'Rien à envoyer' });
    }
    if (photos.length > 10) {
      return alerteReponses('Tu peux envoyer 10 photos au maximum.', 'avertissement', { titre: 'Trop de photos' });
    }
    const tropLourde = [...photos].find((f) => f.size > 8 * 1024 * 1024);
    if (tropLourde) {
      return alerteReponses(`« ${tropLourde.name} » dépasse 8 Mo. Réduis sa taille (ou prends-la en qualité plus basse) et réessaie.`, 'avertissement', { titre: 'Photo trop lourde' });
    }

    envoiEnCours = true;
    const bouton = $('btn-envoyer');
    bouton.disabled = true;
    bouton.textContent = 'Envoi en cours…';
    try {
      const res = await fetch(`/api/jeux/${jeuId}/soumission`, { method: 'POST', body: new FormData(form), credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.errors?.map((e) => e.message).join(' · ') || data.error || `Erreur ${res.status}`);
      effacerBrouillon();
      etat.participation = data.participation;
      afficherFormulaire(data.participation, etat.jeu);
      alerteReponses(data.message, 'succes', { titre: 'Réponses enregistrées' });
      $('reponses-statut').scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (err) {
      alerteReponses(err.message === 'Failed to fetch' ? window.Alerte.HORS_LIGNE : err.message, 'erreur', { titre: 'Envoi impossible' });
      bouton.textContent = etat.participation?.statut === 'terminee' ? 'Mettre à jour mes réponses' : 'Envoyer mes réponses';
    } finally {
      envoiEnCours = false;
      bouton.disabled = false;
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
  $('form-reponses').addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') ecrireBrouillon(); });
  $('form-reponses').addEventListener('submit', envoyerReponses);
  rafraichir();
})();
