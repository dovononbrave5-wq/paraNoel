const form = document.getElementById('formulaire');
const resultat = document.getElementById('resultat');
const bouton = document.getElementById('btn-inscrit');
const { afficher: alerte, lireReponse, messageErreur, HORS_LIGNE } = window.Alerte;

const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Même règle que le serveur (validate.js) : 8 à 72 caractères, majuscule, minuscule, chiffre, caractère spécial
const regexPassword = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,72}$/;

const afficher = (message, type = 'erreur', options) => alerte(resultat, message, type, options);

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  // Vérifications rapides côté navigateur (confort seulement : le serveur revérifie tout)
  if (!regexEmail.test(email)) {
    return afficher('Cette adresse e-mail ne semble pas valide. Exemple : prenom@gmail.com', 'avertissement', { titre: 'E-mail invalide' });
  }
  if (!regexPassword.test(password)) {
    return afficher('Ton mot de passe doit faire au moins 8 caractères et contenir une majuscule, une minuscule, un chiffre et un caractère spécial (ex. ! ? @ #).', 'avertissement', { titre: 'Mot de passe trop faible' });
  }
  if (password !== confirmPassword) {
    return afficher('Les deux mots de passe saisis ne sont pas identiques.', 'avertissement', { titre: 'Confirmation différente' });
  }

  bouton.disabled = true;
  afficher('Création de ton compte…', 'info', { titre: 'Un instant' });

  try {
    // Le hachage du mot de passe se fait uniquement sur le serveur
    const res = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, confirmPassword })
    });
    const data = await lireReponse(res);

    if (res.ok) {
      form.reset();
      afficher(`Nous avons envoyé un lien de confirmation à ${email}. Ton compte sera créé dès que tu cliqueras dessus (pense à regarder dans tes spams).`,
        'succes', { titre: 'Plus qu\'une étape !' });
    } else if (data.code === 'EMAIL_SEND_FAILED') {
      afficher(data.error, 'erreur', { titre: 'E-mail non envoyé' });
    } else {
      afficher(messageErreur(res, data), 'erreur', { titre: res.status === 409 ? 'E-mail déjà inscrit' : undefined });
    }
  } catch (err) {
    afficher(HORS_LIGNE, 'erreur', { titre: 'Pas de connexion' });
  } finally {
    bouton.disabled = false;
  }
});
