// Espace membre : tableau de bord (chiffres, participations, paiements, jeux, compte)
// Toutes les données viennent de GET /api/me/tableau-de-bord. Le texte est inséré avec textContent (jamais innerHTML).
const { afficher: alerte, lireReponse, messageErreur, HORS_LIGNE } = window.Alerte;

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const FORMAT_JOUR = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

const lireDate = (v) => (v ? new Date(String(v).replace(' ', 'T')) : null);
const dateLisible = (v, format = FORMAT_DATE) => {
  const d = lireDate(v);
  return d && !Number.isNaN(d.getTime()) ? format.format(d) : '—';
};
const $ = (id) => document.getElementById(id);

// Crée un élément avec du texte
function element(balise, texte, classe) {
  const el = document.createElement(balise);
  if (texte !== undefined && texte !== null && texte !== '') el.textContent = texte;
  if (classe) el.className = classe;
  return el;
}

function lien(texte, href, classe) {
  const a = element('a', texte, classe);
  a.href = href;
  return a;
}

// Prénom approximatif tiré de l'e-mail : « jean.dupont@… » → « Jean »
function prenomDepuisEmail(email) {
  const debut = String(email || '').split('@')[0].split(/[._\-+0-9]/)[0];
  return debut ? debut.charAt(0).toUpperCase() + debut.slice(1).toLowerCase() : '';
}

function salutation() {
  const h = new Date().getHours();
  return h < 18 ? 'Bonjour' : 'Bonsoir';
}

/* ---------- Bandeau d'accueil ---------- */
function remplirAccueil({ compte, statistiques, evenement }) {
  const prenom = prenomDepuisEmail(compte.email);
  $('tdb-date').textContent = FORMAT_JOUR.format(new Date());
  $('tdb-salut').textContent = `${salutation()}${prenom ? ` ${prenom}` : ''}`;

  let resume;
  if (statistiques.a_terminer > 0) {
    resume = `Tu as ${statistiques.a_terminer} questionnaire${statistiques.a_terminer > 1 ? 's' : ''} à compléter. Ne tarde pas : le chronomètre démarre quand tu cliques sur « Commencer ».`;
  } else if (statistiques.participations === 0) {
    resume = 'Tu ne participes encore à aucun jeu concours. Découvre ceux qui sont ouverts ci-dessous !';
  } else {
    resume = 'Tout est à jour. Retrouve ici tes participations, tes résultats et tes paiements.';
  }
  $('tdb-resume').textContent = resume;

  $('tdb-role').textContent = compte.role_libelle;
  const verifie = $('tdb-verifie');
  verifie.textContent = compte.verifie ? 'E-mail confirmé' : 'E-mail non confirmé';
  verifie.classList.add(compte.verifie ? 'resultat-retenu' : 'badge--danger');

  if (compte.role === 'admin' || compte.role === 'super_admin') $('lien-admin').hidden = false;

  // Compte à rebours jusqu'à l'événement
  const cible = lireDate(evenement.date);
  if (cible && cible > new Date()) {
    const jours = Math.ceil((cible - Date.now()) / 86400000);
    $('tdb-rebours-titre').textContent = evenement.nom ? `${evenement.nom}${evenement.edition ? ` · ${evenement.edition}e édition` : ''}` : 'Le grand jour';
    $('tdb-rebours-jours').textContent = String(jours);
    $('tdb-rebours-unite').textContent = jours > 1 ? 'jours restants' : 'jour restant';
    $('tdb-rebours-date').textContent = `${dateLisible(evenement.date, FORMAT_DATE_HEURE)}${evenement.lieu ? ` · ${evenement.lieu}` : ''}`;
    $('tdb-rebours').hidden = false;
  }
}

/* ---------- Chiffres clés ---------- */
function remplirStatistiques(s) {
  $('stat-participations').textContent = s.participations;
  $('stat-a-terminer').textContent = s.a_terminer;
  $('stat-retenues').textContent = s.retenues;
  $('stat-depense').textContent = s.depense_libelle;
}

/* ---------- Participations : avec une frise Paiement → Questionnaire → Résultat ---------- */
function etapes(p) {
  const fait = (ok) => (ok ? 'frise__etape--faite' : '');
  const liste = element('ol', null, 'frise');
  const items = [
    ['Paiement', 'frise__etape--faite'],
    [p.statut === 'en_cours' ? 'Questionnaire en cours' : 'Questionnaire', p.statut === 'terminee' ? 'frise__etape--faite' : (p.statut === 'en_cours' ? 'frise__etape--active' : '')],
    [p.resultat === 'en_attente' ? 'Résultat' : p.resultat_libelle, p.resultat === 'retenu' ? 'frise__etape--faite' : (p.resultat === 'non_retenu' ? 'frise__etape--neutre' : fait(false))]
  ];
  items.forEach(([texte, classe]) => liste.appendChild(element('li', texte, `frise__etape ${classe}`.trim())));
  return liste;
}

function remplirParticipations(participations) {
  const zone = $('mes-participations');
  zone.replaceChildren();
  if (!participations.length) {
    const vide = element('div', null, 'tdb-vide tdb-vide--grand');
    vide.append(element('p', 'Tu n\'as encore rejoint aucun jeu concours.'), lien('Découvrir les jeux', '/jeux', 'bouton bouton--rouge bouton--petit'));
    zone.appendChild(vide);
    return;
  }

  const liste = element('ul', null, 'liste-participations');
  participations.forEach((p) => {
    const li = element('li', null, 'participation');
    const entete = element('div', null, 'participation__entete');
    entete.append(element('h3', p.titre, 'participation__titre'), element('span', p.phase_libelle, `badge etat-${p.phase}`));
    li.appendChild(entete);
    li.appendChild(etapes(p));

    const meta = element('p', null, 'participation__meta');
    meta.textContent = `Inscrit le ${dateLisible(p.inscrit_le)}`;
    if (p.phase === 'ouvert' && p.statut !== 'terminee') meta.textContent += ` · Clôture le ${dateLisible(p.date_cloture, FORMAT_DATE_HEURE)}`;
    li.appendChild(meta);

    if (p.resultat === 'retenu') {
      li.appendChild(element('p', 'Félicitations ! Tu es retenu(e) pour la rencontre en présentiel.', 'participation__bravo'));
    }
    if (p.statut !== 'terminee' && p.phase === 'ouvert') {
      li.appendChild(lien(p.statut === 'payee' ? 'Commencer le questionnaire' : 'Reprendre le questionnaire', `/participer?jeu=${p.jeu_id}`, 'bouton bouton--rouge bouton--petit'));
    } else if (p.statut !== 'terminee' && p.phase === 'clos') {
      li.appendChild(element('p', 'Le jeu est clôturé : le questionnaire n\'a pas été terminé à temps.', 'participation__meta'));
    }
    liste.appendChild(li);
  });
  zone.appendChild(liste);
}

/* ---------- Rencontres ---------- */
function remplirRencontres(rencontres) {
  if (!rencontres.length) return;
  const liste = $('mes-rencontres');
  rencontres.forEach((r) => {
    const li = element('li', null, 'tdb-item');
    const date = lireDate(r.date);
    const pastille = element('div', null, 'tdb-item__date');
    if (date && !Number.isNaN(date.getTime())) {
      pastille.append(element('strong', String(date.getDate())), element('span', date.toLocaleDateString('fr-FR', { month: 'short' })));
    }
    const corps = element('div', null, 'tdb-item__corps');
    corps.append(
      element('strong', r.jeu),
      element('span', `${dateLisible(r.date, FORMAT_DATE_HEURE)}${r.lieu ? ` · ${r.lieu}` : ''}`, 'tdb-item__meta')
    );
    if (r.infos) corps.appendChild(element('span', r.infos, 'tdb-item__meta'));
    if (r.retenu) corps.appendChild(element('span', 'Tu es attendu(e) !', 'badge resultat-retenu'));
    li.append(pastille, corps);
    liste.appendChild(li);
  });
  $('bloc-rencontres').hidden = false;
}

/* ---------- Paiements ---------- */
function remplirPaiements(paiements) {
  const zone = $('mes-paiements');
  zone.replaceChildren();
  if (!paiements.length) {
    zone.appendChild(element('p', 'Aucun paiement pour le moment. Tes reçus apparaîtront ici après ta première participation.', 'tdb-vide'));
    return;
  }
  const cadre = element('div', null, 'tdb-tableau');
  const table = element('table');
  const entete = element('tr');
  ['Date', 'Jeu', 'Montant', 'Moyen', 'Statut', 'Reçu'].forEach((t) => entete.appendChild(element('th', t)));
  table.appendChild(element('thead')).appendChild(entete);
  const corps = element('tbody');
  paiements.forEach((p) => {
    const tr = element('tr');
    tr.append(
      element('td', dateLisible(p.date)),
      element('td', p.jeu),
      element('td', p.montant_libelle, 'tdb-montant'),
      element('td', p.operateur)
    );
    const statut = element('td');
    statut.appendChild(element('span', p.statut_libelle, `badge paiement-${p.statut}`));
    tr.appendChild(statut);
    const recu = element('td');
    if (p.statut === 'reussi') {
      const bouton = element('button', 'Renvoyer', 'bouton-petit');
      bouton.type = 'button';
      bouton.title = 'Recevoir à nouveau le reçu par e-mail';
      bouton.addEventListener('click', () => renvoyerRecu(p.cle, bouton));
      recu.appendChild(bouton);
    } else {
      recu.textContent = '—';
    }
    tr.appendChild(recu);
    tr.title = `Référence ${p.reference}`;
    corps.appendChild(tr);
  });
  table.appendChild(corps);
  cadre.appendChild(table);
  zone.appendChild(cadre);
}

// Renvoie le reçu (ticket + jeu) sur l'e-mail du membre
async function renvoyerRecu(cle, bouton) {
  const zone = $('recu-resultat');
  bouton.disabled = true;
  try {
    const res = await fetch(`/api/me/paiements/${encodeURIComponent(cle)}/recu`, { method: 'POST' });
    const data = await lireReponse(res);
    if (res.ok) alerte(zone, `${data.message} Pense à regarder dans tes spams.`, 'succes', { titre: 'Reçu envoyé' });
    else alerte(zone, messageErreur(res, data));
  } catch (err) {
    alerte(zone, HORS_LIGNE, 'erreur', { titre: 'Pas de connexion' });
  } finally {
    bouton.disabled = false;
  }
}

/* ---------- Jeux à découvrir ---------- */
function remplirJeux(jeux) {
  const liste = $('jeux-a-decouvrir');
  liste.replaceChildren();
  if (!jeux.length) {
    liste.appendChild(element('li', 'Aucun nouveau jeu pour l\'instant. Reviens bientôt, de nouveaux concours arrivent !', 'tdb-vide'));
    return;
  }
  jeux.forEach((j) => {
    const li = element('li', null, 'tdb-item tdb-item--jeu');
    const corps = element('div', null, 'tdb-item__corps');
    const titre = element('strong', j.titre);
    const meta = j.phase === 'ouvert'
      ? `${j.prix_libelle} · jusqu'au ${dateLisible(j.date_cloture)}`
      : `${j.prix_libelle} · ouvre le ${dateLisible(j.date_ouverture)}`;
    corps.append(titre, element('span', meta, 'tdb-item__meta'), element('span', j.phase_libelle, `badge etat-${j.phase}`));
    li.append(corps, lien(j.phase === 'ouvert' ? 'Participer' : 'Voir', `/participer?jeu=${j.id}`, 'bouton bouton--contour bouton--petit'));
    liste.appendChild(li);
  });
}

/* ---------- Compte ---------- */
function remplirCompte(compte) {
  $('user-email').textContent = compte.email;
  $('user-id').textContent = String(compte.id).padStart(4, '0');
  $('user-inscription').textContent = dateLisible(compte.inscrit_le);
  $('user-connexion').textContent = compte.derniere_connexion ? dateLisible(compte.derniere_connexion, FORMAT_DATE_HEURE) : 'Première connexion';
  const methodes = [];
  if (compte.a_mot_de_passe) methodes.push('E-mail et mot de passe');
  if (compte.connexion_google) methodes.push('Google');
  $('user-methode').textContent = methodes.join(' · ') || '—';

  // Compte Google sans mot de passe : on propose d'en créer un
  if (!compte.a_mot_de_passe) {
    $('mdp-titre').textContent = 'Créer un mot de passe';
    $('champ-actuel').hidden = true;
  }
}

/* ---------- Chargement ---------- */
async function chargerTableauDeBord() {
  const zoneAlerte = $('alerte-page');
  try {
    const res = await fetch('/api/me/tableau-de-bord');
    if (res.status === 401) {
      window.location.href = '/login?retour=/dashboard';
      return;
    }
    const data = await lireReponse(res);
    if (!res.ok) throw Object.assign(new Error(messageErreur(res, data)), { serveur: true });

    remplirAccueil(data);
    remplirStatistiques(data.statistiques);
    remplirParticipations(data.participations);
    remplirRencontres(data.rencontres);
    remplirPaiements(data.paiements);
    remplirJeux(data.jeux);
    remplirCompte(data.compte);

    if (!data.compte.verifie) {
      alerte(zoneAlerte, 'Ton adresse e-mail n\'est pas encore confirmée. Ouvre le lien reçu par e-mail pour sécuriser ton compte.', 'avertissement', { titre: 'E-mail à confirmer' });
    }
  } catch (err) {
    alerte(zoneAlerte, err.serveur ? err.message : HORS_LIGNE, 'erreur', {
      titre: 'Impossible de charger ton espace',
      lien: { texte: 'Recharger la page', href: '/dashboard' }
    });
    $('tdb-resume').textContent = 'Tes informations n\'ont pas pu être chargées.';
    ['mes-participations', 'mes-paiements'].forEach((id) => { $(id).replaceChildren(element('p', '—', 'tdb-vide')); });
    $('jeux-a-decouvrir').replaceChildren(element('li', '—', 'tdb-vide'));
  } finally {
    document.querySelector('.tdb').removeAttribute('aria-busy');
  }
}

/* ---------- Mot de passe ---------- */
$('form-mdp').addEventListener('submit', async (event) => {
  event.preventDefault();
  const zone = $('mdp-resultat');
  const bouton = $('mdp-bouton');
  const corps = {
    actuel: $('mdp-actuel').value,
    nouveau: $('mdp-nouveau').value,
    confirmation: $('mdp-confirmation').value
  };
  if (corps.nouveau !== corps.confirmation) {
    return alerte(zone, 'Les deux nouveaux mots de passe ne sont pas identiques.', 'avertissement', { titre: 'Confirmation différente' });
  }
  bouton.disabled = true;
  try {
    const res = await fetch('/api/me/mot-de-passe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps)
    });
    const data = await lireReponse(res);
    if (res.ok) {
      event.target.reset();
      alerte(zone, data.message, 'succes', { titre: 'Mot de passe enregistré' });
      $('champ-actuel').hidden = false;
      $('mdp-titre').textContent = 'Changer mon mot de passe';
    } else {
      alerte(zone, messageErreur(res, data));
    }
  } catch (err) {
    alerte(zone, HORS_LIGNE, 'erreur', { titre: 'Pas de connexion' });
  } finally {
    bouton.disabled = false;
  }
});

/* ---------- Déconnexion ---------- */
$('logout-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/auth/logout', { method: 'POST' });
    const data = await lireReponse(res);
    window.location.href = data.redirect || '/login';
  } catch (err) {
    alerte($('alerte-page'), 'La déconnexion n\'a pas abouti. Vérifie ta connexion et réessaie.', 'erreur', { titre: 'Déconnexion impossible' });
  }
});

chargerTableauDeBord();
