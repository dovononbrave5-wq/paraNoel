// Rubrique « Inscrits et rôles » (super-administrateur) :
// liste filtrée et paginée, nommer / retirer un administrateur, suspendre / réactiver un compte.
(function () {
  const { api, remplir, notifier, confirmer, erreursFormulaire, succesFormulaire } = window.Admin;
  const section = () => document.getElementById('utilisateurs');
  let page = 1;
  let pages = 1;
  let minuterie;

  async function charger() {
    const tbody = document.getElementById('tbody-utilisateurs');
    const etat = document.getElementById('etat-utilisateurs');
    const params = new URLSearchParams({
      page,
      recherche: document.getElementById('recherche-utilisateurs').value.trim(),
      role: document.getElementById('filtre-role').value,
      statut: document.getElementById('filtre-statut').value
    });
    etat.hidden = false;
    etat.textContent = 'Chargement…';
    try {
      const data = await api(`/api/admin/utilisateurs?${params}`);
      pages = data.pages;
      tbody.textContent = '';
      data.utilisateurs.forEach((u) => tbody.appendChild(ligne(u)));
      etat.hidden = data.utilisateurs.length > 0;
      etat.textContent = 'Aucun inscrit ne correspond à ces critères.';
      document.getElementById('info-pagination').textContent = `Page ${data.page} sur ${data.pages} · ${data.total} inscrit${data.total > 1 ? 's' : ''}`;
      document.getElementById('page-precedente').disabled = data.page <= 1;
      document.getElementById('page-suivante').disabled = data.page >= data.pages;
    } catch (err) {
      etat.textContent = `Chargement impossible : ${err.message}`;
    }
  }

  // Une ligne du tableau, avec seulement les boutons utiles pour ce compte
  function ligne(u) {
    const fragment = remplir(document.getElementById('modele-utilisateur'), u);
    const tr = fragment.firstElementChild;
    tr.dataset.email = u.email;
    if (u.statut === 'suspendu') tr.classList.add('tableau__ligne--attenuee');
    if (u.role === 'super_admin') tr.querySelector('.badge').classList.add('badge--or');

    const modifiable = !u.est_moi && u.role !== 'super_admin';
    const visible = {
      promouvoir: modifiable && u.role === 'membre' && u.is_verified && u.statut === 'actif',
      retrograder: modifiable && u.role === 'admin',
      suspendre: modifiable && u.statut === 'actif',
      reactiver: modifiable && u.statut === 'suspendu',
      historique: true
    };
    tr.querySelectorAll('[data-action]').forEach((b) => {
      if (!visible[b.dataset.action]) b.remove();
      else b.setAttribute('aria-label', `${b.textContent} : ${u.email}`);
    });
    return fragment;
  }

  async function action(nom, id, email) {
    const actions = {
      promouvoir: { url: `role`, corps: { role: 'admin' }, question: `Nommer ${email} administrateur ? Il pourra gérer les jeux, les paiements, les annonces et les messages.` },
      retrograder: { url: `role`, corps: { role: 'membre' }, question: `Retirer le rôle d'administrateur à ${email} ?` },
      suspendre: { url: `statut`, corps: { statut: 'suspendu' }, question: `Suspendre le compte ${email} ? La personne sera déconnectée et ne pourra plus se connecter.` },
      reactiver: { url: `statut`, corps: { statut: 'actif' }, question: `Réactiver le compte ${email} ?` }
    };
    if (nom === 'historique') {
      // Ouvre le journal filtré sur cet utilisateur
      document.getElementById('journal-utilisateur').value = email;
      location.hash = 'journal';
      return;
    }
    const a = actions[nom];
    if (!a || !(await confirmer(a.question))) return;
    try {
      const data = await api(`/api/admin/utilisateurs/${id}/${a.url}`, { method: 'PATCH', body: a.corps });
      notifier(data.message);
      charger();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  }

  document.addEventListener('admin:section', (e) => {
    if (e.detail.id === 'utilisateurs') charger();
  });

  // Les éléments n'existent pas pour un simple admin (retirés par admin.js) : on attend que le rôle soit connu
  window.Admin.pret.then(() => {
    if (!section()) return;

    document.getElementById('tbody-utilisateurs').addEventListener('click', (event) => {
      const bouton = event.target.closest('button[data-action]');
      if (!bouton) return;
      const tr = bouton.closest('tr');
      action(bouton.dataset.action, tr.dataset.id, tr.dataset.email);
    });

    // Recherche : attend une courte pause de frappe avant d'interroger le serveur
    document.getElementById('recherche-utilisateurs').addEventListener('input', () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => { page = 1; charger(); }, 300);
    });
    ['filtre-role', 'filtre-statut'].forEach((id) => document.getElementById(id).addEventListener('change', () => { page = 1; charger(); }));
    document.getElementById('page-precedente').addEventListener('click', () => { if (page > 1) { page--; charger(); } });
    document.getElementById('page-suivante').addEventListener('click', () => { if (page < pages) { page++; charger(); } });

    // Nommer un administrateur à partir de son e-mail
    const form = document.getElementById('form-nommer-admin');
    const resultat = document.getElementById('resultat-nommer-admin');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = form.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return erreursFormulaire(form, resultat, { message: 'Saisissez une adresse e-mail valide.', errors: [{ champ: 'email' }] });
      }
      if (!(await confirmer(`Nommer ${email} administrateur ?`))) return;
      try {
        const data = await api('/api/admin/administrateurs', { method: 'POST', body: { email } });
        succesFormulaire(form, resultat, data.message);
        form.reset();
        charger();
      } catch (err) {
        erreursFormulaire(form, resultat, err);
      }
    });
  }).catch(() => {});
})();
