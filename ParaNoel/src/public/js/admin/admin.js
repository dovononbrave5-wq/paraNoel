// Socle du tableau de bord : outils partagés par tous les scripts admin-*.js (objet window.Admin).
//  - Admin.api(url, options)      appel au serveur (JSON ou FormData), gestion des erreurs
//  - Admin.remplir(modele, item)  clone un <template> et remplit data-champ, data-champ-date…
//  - Admin.confirmer(texte)       boîte de confirmation → Promise<boolean>
//  - Admin.notifier(texte, type)  petit message en bas de l'écran
//  - Admin.pret                   Promise résolue quand l'utilisateur et son rôle sont connus
// Tous les textes sont écrits avec textContent : rien de ce qui vient des visiteurs n'est interprété comme du HTML.
(function () {
  const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const vide = (v) => v === null || v === undefined || String(v).trim() === '';
  const lireDate = (v) => new Date(String(v).replace(' ', 'T'));

  // Date lisible ; avec l'heure si elle n'est pas minuit
  function formatDate(valeur) {
    if (vide(valeur)) return '–';
    const date = lireDate(valeur);
    if (Number.isNaN(date.getTime())) return '–';
    const avecHeure = /\d{2}:\d{2}/.test(valeur) && !/00:00:00$/.test(valeur);
    return (avecHeure ? FORMAT_DATE_HEURE : FORMAT_DATE).format(date);
  }

  // --- Appels au serveur ---
  async function api(url, { method = 'GET', body } = {}) {
    const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body instanceof FormData) options.body = body;
    else if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, options);
    } catch {
      throw Object.assign(new Error('Impossible de joindre le serveur.'), { errors: [] });
    }
    // Session expirée ou rôle retiré : retour à la connexion
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Session expirée');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data.errors?.length
        ? data.errors.map((e) => e.message).join(' · ')
        : (res.status === 403 ? 'Accès refusé : action réservée au super-administrateur.' : data.error || `Erreur ${res.status}`);
      throw Object.assign(new Error(message), { errors: data.errors || [], status: res.status });
    }
    return data;
  }

  // --- Modèles <template> ---
  function avecAttribut(racines, attribut) {
    const resultat = [];
    racines.forEach((r) => {
      if (r.hasAttribute(attribut)) resultat.push(r);
      resultat.push(...r.querySelectorAll(`[${attribut}]`));
    });
    return resultat;
  }

  function remplir(modele, item) {
    const fragment = modele.content.cloneNode(true);
    const racines = [...fragment.children];
    avecAttribut(racines, 'data-champ').forEach((el) => {
      const valeur = item[el.dataset.champ];
      if (el.tagName === 'IMG') {
        if (!vide(valeur)) el.src = valeur;
        el.alt = '';
      } else {
        el.textContent = vide(valeur) ? '–' : String(valeur);
      }
    });
    avecAttribut(racines, 'data-champ-date').forEach((el) => {
      const valeur = item[el.dataset.champDate];
      el.textContent = formatDate(valeur);
      if (el.tagName === 'TIME' && !vide(valeur)) el.dateTime = String(valeur).replace(' ', 'T');
    });
    avecAttribut(racines, 'data-lien-depuis').forEach((el) => {
      const valeur = item[el.dataset.lienDepuis];
      if (vide(valeur)) el.replaceWith(document.createTextNode('–'));
      else el.href = valeur;
    });
    // L'identifiant de l'élément est gardé sur la première balise (ligne du tableau)
    if (racines[0] && item.id !== undefined) racines[0].dataset.id = item.id;
    return fragment;
  }

  // --- Messages ---
  const zoneNotification = document.getElementById('notification');
  let minuterie;
  function notifier(texte, type = 'succes') {
    zoneNotification.textContent = texte;
    zoneNotification.className = `notification notification--${type}`;
    zoneNotification.hidden = false;
    clearTimeout(minuterie);
    minuterie = setTimeout(() => { zoneNotification.hidden = true; }, type === 'erreur' ? 6000 : 3500);
  }

  // Boîte de confirmation (balise <dialog>) : résout true si « Confirmer » est choisi
  const dialogueConfirmation = document.getElementById('dialogue-confirmation');
  function confirmer(texte, titre = 'Confirmer') {
    return new Promise((resolve) => {
      document.getElementById('confirmation-titre').textContent = titre;
      document.getElementById('confirmation-texte').textContent = texte;
      dialogueConfirmation.returnValue = 'non';
      dialogueConfirmation.addEventListener('close', () => resolve(dialogueConfirmation.returnValue === 'oui'), { once: true });
      dialogueConfirmation.showModal();
    });
  }

  // Affiche les erreurs d'un formulaire : champs en rouge (aria-invalid) et message
  function erreursFormulaire(form, zone, err) {
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    (err.errors || []).forEach(({ champ }) => {
      const el = champ && form.elements[champ];
      if (el?.setAttribute) el.setAttribute('aria-invalid', 'true');
    });
    if (zone) {
      zone.textContent = err.message;
      zone.className = 'formulaire__resultat formulaire__resultat--erreur';
    }
  }
  function succesFormulaire(form, zone, texte) {
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    if (zone) {
      zone.textContent = texte;
      zone.className = 'formulaire__resultat formulaire__resultat--succes';
    }
  }

  // Champs obligatoires vides (vérification rapide avant l'envoi ; le serveur revérifie)
  function champsManquants(form) {
    return [...form.querySelectorAll('[required]')]
      .filter((el) => (el.type === 'checkbox' ? !el.checked : el.type === 'file' ? !el.files.length : !el.value.trim()))
      .map((el) => ({ champ: el.name, message: `${form.querySelector(`label[for="${el.id}"]`)?.firstChild?.textContent.trim() || el.name} : champ obligatoire` }));
  }

  // --- Vue d'ensemble (chiffres, dernières inscriptions, activité récente) ---
  const compteur = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(n);
    el.hidden = !n;
  };

  async function rafraichirStats() {
    try {
      const s = await api('/api/admin/stats');
      const valeurs = {
        'stat-inscrits': s.inscrits, 'stat-nouveaux': s.nouveaux, 'stat-non-verifies': s.non_verifies,
        'stat-admins': s.admins, 'stat-messages': s.messages, 'stat-participants': s.participants,
        'stat-recettes': s.recettes_libelle, 'stat-jeux-ouverts': s.jeux_ouverts
      };
      Object.entries(valeurs).forEach(([id, v]) => { document.getElementById(id).textContent = String(v ?? '–'); });
      compteur('compteur-messages', s.messages);

      const tbody = document.getElementById('tbody-derniers-inscrits');
      if (tbody && s.derniers_inscrits) {
        tbody.textContent = '';
        s.derniers_inscrits.forEach((u) => tbody.appendChild(remplir(document.getElementById('modele-dernier-inscrit'), u)));
      }
      const activite = document.getElementById('liste-activite-recente');
      activite.textContent = '';
      s.activite.forEach((a) => activite.appendChild(remplir(document.getElementById('modele-activite'), a)));
      if (!s.activite.length) {
        const li = document.createElement('li');
        li.className = 'activite__element';
        li.textContent = 'Aucune activité pour le moment.';
        activite.appendChild(li);
      }
    } catch (err) {
      notifier(`Vue d'ensemble : ${err.message}`, 'erreur');
    }
  }

  // --- Utilisateur connecté et rôle ---
  const ROLES = { admin: 'Administrateur', super_admin: 'Super-administrateur' };
  const pret = api('/api/me').then((moi) => {
    document.getElementById('admin-email').textContent = moi.email;
    document.getElementById('admin-role').textContent = ROLES[moi.role] || moi.role;
    // Un simple admin ne voit pas les rubriques du super-admin (le serveur les refuse de toute façon)
    if (moi.role !== 'super_admin') {
      document.querySelectorAll('[data-role-requis="super_admin"]').forEach((el) => el.remove());
    }
    window.Admin.utilisateur = moi;
    return moi;
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      const data = await api('/auth/logout', { method: 'POST' });
      window.location.href = data.redirect || '/login';
    } catch (err) {
      notifier('La déconnexion a échoué, réessayez.', 'erreur');
    }
  });

  // Fermer une boîte de dialogue avec ses boutons « Annuler » (data-action="fermer")
  document.addEventListener('click', (event) => {
    const bouton = event.target.closest('dialog [data-action="fermer"]');
    if (bouton) bouton.closest('dialog').close();
  });

  window.Admin = { api, remplir, formatDate, notifier, confirmer, erreursFormulaire, succesFormulaire, champsManquants, rafraichirStats, pret, utilisateur: null };

  // Chiffres et compteurs du menu rafraîchis à chaque changement de rubrique
  document.addEventListener('admin:section', rafraichirStats);
})();
