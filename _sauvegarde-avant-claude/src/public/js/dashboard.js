// Espace membre : informations du compte, lien vers l'administration et participations aux jeux
const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const lireDate = (v) => new Date(String(v).replace(' ', 'T'));

async function loadUser() {
  try {
    const res = await fetch('/api/me');

    // Session expirée : retour à la connexion
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }

    const user = await res.json();
    document.getElementById('welcome').textContent = `Connecté en tant que ${user.email}`;
    document.getElementById('user-id').textContent = user.id;
    document.getElementById('user-email').textContent = user.email;

    // Lien vers le tableau de bord, pour les administrateurs (le serveur protège /admin de toute façon)
    if (user.role === 'admin' || user.role === 'super_admin') {
      document.getElementById('lien-admin').hidden = false;
    }
    loadParticipations();
  } catch (err) {
    document.getElementById('welcome').textContent = 'Impossible de charger tes informations.';
  }
}

// Crée un élément avec du texte (jamais innerHTML)
function element(balise, texte, classe) {
  const el = document.createElement(balise);
  if (texte) el.textContent = texte;
  if (classe) el.className = classe;
  return el;
}

async function loadParticipations() {
  const zone = document.getElementById('mes-participations');
  try {
    const res = await fetch('/api/me/participations');
    if (!res.ok) return;
    const participations = await res.json();
    if (!participations.length) return; // le message « aucun jeu » reste

    const liste = element('ul', null, 'liste-participations');
    participations.forEach((p) => {
      const li = element('li', null, 'participation');
      li.appendChild(element('h3', p.titre, 'participation__titre'));
      const etat = element('p', null, 'participation__etat');
      etat.append(element('span', p.statut_libelle, 'badge'), ' ', element('span', p.resultat_libelle, `badge resultat-${p.resultat}`));
      li.appendChild(etat);

      if (p.rencontre) {
        const rencontre = element('p', null, 'participation__rencontre');
        rencontre.append(element('strong', 'Rencontre en présentiel : '), `${FORMAT_DATE.format(lireDate(p.rencontre.date))} · ${p.rencontre.lieu}`);
        li.appendChild(rencontre);
        if (p.rencontre.infos) li.appendChild(element('p', p.rencontre.infos, 'participation__infos'));
      }
      // Questionnaire à commencer ou à terminer
      if (p.statut !== 'terminee' && p.phase === 'ouvert') {
        const lien = element('a', p.statut === 'payee' ? 'Commencer le questionnaire' : 'Reprendre le questionnaire', 'bouton bouton--rouge bouton--petit');
        lien.href = `/participer?jeu=${p.jeu_id}`;
        li.appendChild(lien);
      }
      liste.appendChild(li);
    });
    zone.replaceWith(liste);
  } catch (err) {
    /* la liste reste vide */
  }
}

async function logout() {
  try {
    const res = await fetch('/auth/logout', { method: 'POST' });
    const data = await res.json();
    window.location.href = data.redirect || '/login';
  } catch (err) {
    alert('La déconnexion a échoué, réessaie.');
  }
}

document.getElementById('logout-btn').addEventListener('click', logout);
loadUser();
