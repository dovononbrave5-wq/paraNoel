// Formulaire de contact : vérifications rapides puis envoi à POST /api/contact (JSON).
// Le serveur revérifie tout (validate.js) : ces contrôles ne sont qu'un confort pour le visiteur.
(function () {
  const form = document.getElementById('formulaire');
  if (!form) return;
  const resultat = document.getElementById('resultat-contact');
  const bouton = document.getElementById('btn-message');
  const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const REGEX_TELEPHONE = /^\+?[0-9 .()-]{8,20}$/;

  // Lien « Devenir partenaire » : /contact?objet=partenariat#formulaire
  const objet = new URLSearchParams(location.search).get('objet');
  if (objet && form.objet.querySelector(`option[value="${CSS.escape(objet)}"]`)) form.objet.value = objet;

  function afficher(message, type) {
    resultat.textContent = message;
    resultat.className = `formulaire__resultat formulaire__resultat--${type}`;
  }

  function marquer(erreurs) {
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    erreurs.forEach(({ champ }) => form.elements[champ]?.setAttribute?.('aria-invalid', 'true'));
    const premier = erreurs.map(({ champ }) => form.elements[champ]).find((el) => el?.focus);
    if (premier) premier.focus();
  }

  function verifier(d) {
    const erreurs = [];
    if (d.nom.length < 2) erreurs.push({ champ: 'nom', message: 'Indiquez votre nom.' });
    if (!REGEX_EMAIL.test(d.email)) erreurs.push({ champ: 'email', message: 'Adresse e-mail invalide.' });
    if (d.telephone && !REGEX_TELEPHONE.test(d.telephone)) erreurs.push({ champ: 'telephone', message: 'Numéro de téléphone invalide.' });
    if (!d.objet) erreurs.push({ champ: 'objet', message: 'Choisissez le type de projet.' });
    if (d.message.length < 10) erreurs.push({ champ: 'message', message: 'Votre message doit contenir au moins 10 caractères.' });
    if (!d.consentement) erreurs.push({ champ: 'consentement', message: 'Merci de cocher la case de consentement.' });
    return erreurs;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const donnees = {
      nom: form.nom.value.trim(),
      email: form.email.value.trim(),
      telephone: form.telephone.value.trim(),
      objet: form.objet.value,
      message: form.message.value.trim(),
      consentement: form.consentement.checked,
      site_web: form.site_web.value // piège à robots : vide pour un humain
    };

    const erreurs = verifier(donnees);
    marquer(erreurs);
    if (erreurs.length) return afficher(erreurs.map((e) => e.message).join(' '), 'erreur');

    bouton.disabled = true;
    afficher('Envoi en cours…', 'info');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(donnees)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        form.reset();
        afficher(data.message || 'Message envoyé.', 'succes');
      } else if (data.errors) {
        marquer(data.errors);
        afficher(data.errors.map((e) => e.message).join(' · '), 'erreur');
      } else {
        afficher(data.error || 'Une erreur est survenue. Réessayez.', 'erreur');
      }
    } catch (err) {
      afficher('Impossible de joindre le serveur. Vérifiez votre connexion.', 'erreur');
    } finally {
      bouton.disabled = false;
    }
  });
})();
