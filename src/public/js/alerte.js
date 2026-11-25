// Messages affichés aux visiteurs : un encadré coloré avec une icône, un titre court et une explication.
// Utilisé par les pages de connexion, d'inscription et l'espace membre.
(function () {
  const TITRES = {
    erreur: 'Oups…',
    avertissement: 'À noter',
    succes: 'C\'est fait !',
    info: 'Un instant…'
  };
  const ICONES = { erreur: '!', avertissement: '!', succes: '✓', info: 'i' };

  // Messages techniques du serveur → phrases compréhensibles
  const TRADUCTIONS = [
    [/service temporairement indisponible|erreur interne/i,
      'Le site rencontre un petit souci de notre côté. Réessaie dans quelques instants.'],
    [/trop de tentatives/i,
      'Tu as fait beaucoup d\'essais d\'affilée. Patiente quelques minutes avant de réessayer.'],
    [/e-mail ou mot de passe incorrect/i,
      'L\'e-mail ou le mot de passe ne correspond pas. Vérifie ta saisie (majuscules comprises).'],
    [/déjà utilisé/i,
      'Un compte existe déjà avec cet e-mail. Connecte-toi, ou utilise « Continuer avec Google ».'],
    [/confirmer votre adresse e-mail/i,
      'Ton adresse e-mail n\'est pas encore confirmée. Ouvre le lien reçu par e-mail, ou demande-en un nouveau ci-dessous.'],
    [/compte est suspendu/i,
      'Ce compte est suspendu. Contacte l\'organisation pour en savoir plus.'],
    [/requête invalide|json mal formé/i,
      'Le formulaire n\'a pas pu être envoyé correctement. Recharge la page et réessaie.']
  ];

  function traduire(message) {
    const texte = String(message || '').trim();
    const trouve = TRADUCTIONS.find(([motif]) => motif.test(texte));
    return trouve ? trouve[1] : texte;
  }

  /**
   * afficherAlerte(zone, message, type, { titre, lien })
   * type : 'erreur' | 'avertissement' | 'succes' | 'info'
   * lien : { texte, href } facultatif (ex. « Aller à la connexion »)
   */
  function afficherAlerte(zone, message, type = 'erreur', options = {}) {
    if (!zone) return;
    zone.replaceChildren();
    if (!message) { zone.className = 'alerte'; return; }

    zone.className = `alerte alerte--${type}`;
    zone.setAttribute('role', type === 'erreur' ? 'alert' : 'status');

    const icone = document.createElement('span');
    icone.className = 'alerte__icone';
    icone.setAttribute('aria-hidden', 'true');
    icone.textContent = ICONES[type] || 'i';

    const corps = document.createElement('div');
    corps.className = 'alerte__corps';
    const titre = document.createElement('strong');
    titre.className = 'alerte__titre';
    titre.textContent = options.titre || TITRES[type] || '';
    const texte = document.createElement('p');
    texte.className = 'alerte__texte';
    texte.textContent = traduire(message);
    corps.append(titre, texte);

    if (options.lien) {
      const a = document.createElement('a');
      a.className = 'alerte__lien';
      a.href = options.lien.href;
      a.textContent = options.lien.texte;
      corps.appendChild(a);
    }
    zone.append(icone, corps);
  }

  // Lit la réponse JSON du serveur sans planter si elle n'en contient pas
  async function lireReponse(res) {
    try { return await res.json(); } catch { return {}; }
  }

  // Message d'erreur à afficher pour une réponse refusée
  function messageErreur(res, data) {
    if (data && Array.isArray(data.errors) && data.errors.length) {
      return data.errors.map((e) => e.message).join(' · ');
    }
    if (data && data.error) return data.error;
    if (res && res.status === 429) return 'Trop de tentatives';
    if (res && res.status >= 500) return 'Erreur interne';
    return 'Une erreur inattendue est survenue. Réessaie dans un instant.';
  }

  const HORS_LIGNE = 'Impossible de joindre le site. Vérifie ta connexion Internet, puis réessaie.';

  window.Alerte = { afficher: afficherAlerte, traduire, lireReponse, messageErreur, HORS_LIGNE };
})();
