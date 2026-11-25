const form = document.getElementById('formulaire-connexion');
const resultat = document.getElementById('resultat');
const btnConnexion = document.getElementById('btn-connexion');
const btnRenvoyer = document.getElementById('btn-renvoyer');
const { afficher: alerte, lireReponse, messageErreur, HORS_LIGNE } = window.Alerte;

const afficher = (message, type = 'erreur', options) => alerte(resultat, message, type, options);

// Messages envoyés par le serveur dans l'adresse (/login?verified=1, ?verify=invalid, ?error=...)
const params = new URLSearchParams(window.location.search);
if (params.get('verified') === '1') {
  afficher('Ton adresse e-mail est confirmée. Tu peux maintenant te connecter.', 'succes', { titre: 'Bienvenue !' });
} else if (params.get('verify') === 'invalid') {
  afficher('Ce lien de confirmation n\'est plus valable (il expire au bout de 24 h). Saisis ton e-mail ci-dessus, puis demande un nouveau lien.', 'avertissement', { titre: 'Lien expiré' });
  btnRenvoyer.hidden = false;
} else if (params.get('error') === 'provider') {
  afficher('La connexion avec Google n\'est pas encore disponible. Utilise ton e-mail et ton mot de passe.', 'info', { titre: 'Bientôt disponible' });
} else if (params.get('error') === 'suspendu') {
  afficher('Ce compte est suspendu.');
} else if (params.get('error') === 'oauth') {
  afficher('La connexion avec Google n\'a pas abouti. Réessaie, ou connecte-toi avec ton e-mail.', 'erreur', { titre: 'Connexion Google interrompue' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  btnRenvoyer.hidden = true;

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const remember = document.getElementById('remember').checked;

  if (!email || !password) {
    return afficher('Saisis ton e-mail et ton mot de passe pour te connecter.', 'avertissement', { titre: 'Champs manquants' });
  }

  btnConnexion.disabled = true;
  afficher('Vérification de tes identifiants…', 'info', { titre: 'Connexion en cours' });

  try {
    // La vérification du mot de passe se fait uniquement sur le serveur
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, remember })
    });
    const data = await lireReponse(res);

    if (res.ok) {
      // Retour vers la page d'origine (ex. /participer?jeu=3), seulement si c'est une page de ce site
      const retour = params.get('retour');
      const retourSur = retour && /^\/(?!\/)/.test(retour) && !retour.includes('\\') ? retour : null;
      window.location.href = retourSur || data.redirect || '/dashboard';
      return;
    }
    if (data.code === 'EMAIL_NOT_VERIFIED') {
      afficher(data.error, 'avertissement', { titre: 'E-mail à confirmer' });
      btnRenvoyer.hidden = false;
    } else {
      afficher(messageErreur(res, data), 'erreur', { titre: res.status === 401 ? 'Identifiants incorrects' : undefined });
    }
  } catch (err) {
    afficher(HORS_LIGNE, 'erreur', { titre: 'Pas de connexion' });
  } finally {
    btnConnexion.disabled = false;
  }
});

btnRenvoyer.addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  if (!email) {
    return afficher('Saisis ton e-mail dans le champ ci-dessus, puis clique à nouveau sur « Renvoyer le lien ».', 'avertissement', { titre: 'E-mail manquant' });
  }

  btnRenvoyer.disabled = true;
  try {
    const res = await fetch('/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await lireReponse(res);
    if (res.ok) {
      afficher('Si un compte non confirmé existe pour cet e-mail, un nouveau lien vient de partir. Pense à regarder dans tes spams.', 'succes', { titre: 'Lien envoyé' });
    } else {
      afficher(messageErreur(res, data));
    }
  } catch (err) {
    afficher(HORS_LIGNE, 'erreur', { titre: 'Pas de connexion' });
  } finally {
    btnRenvoyer.disabled = false;
  }
});
