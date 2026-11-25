// Rubrique « Messages reçus » : lire, marquer traité, supprimer.
(function () {
  const { api, remplir, notifier, confirmer, formatDate, rafraichirStats } = window.Admin;
  let messages = [];

  async function charger() {
    const tbody = document.getElementById('tbody-messages');
    const etat = document.getElementById('etat-messages');
    const statut = document.getElementById('filtre-messages').value;
    etat.hidden = false;
    etat.textContent = 'Chargement…';
    try {
      messages = await api(`/api/admin/messages${statut ? `?statut=${statut}` : ''}`);
      tbody.textContent = '';
      messages.forEach((m) => {
        const fragment = remplir(document.getElementById('modele-message'), m);
        const tr = fragment.firstElementChild;
        if (m.statut === 'traite') {
          tr.querySelector('[data-action="traiter"]').remove();
        } else {
          tr.classList.add('tableau__ligne--nouveau');
          tr.querySelector('.badge').classList.add('badge--or');
        }
        tr.querySelectorAll('[data-action]').forEach((b) => b.setAttribute('aria-label', `${b.textContent} : message de ${m.nom}`));
        tbody.appendChild(fragment);
      });
      etat.hidden = messages.length > 0;
      etat.textContent = statut === 'nouveau' ? 'Aucun nouveau message. Tout est traité !' : 'Aucun message.';
    } catch (err) {
      etat.textContent = `Chargement impossible : ${err.message}`;
    }
  }

  function lire(m) {
    document.getElementById('message-nom').textContent = m.nom;
    document.getElementById('message-date').textContent = formatDate(m.date);
    const email = document.getElementById('message-email');
    email.textContent = m.email;
    email.href = `mailto:${m.email}`;
    const tel = document.getElementById('message-telephone');
    tel.textContent = m.telephone || '–';
    tel.href = m.telephone ? `tel:${m.telephone.replace(/[^\d+]/g, '')}` : 'tel:';
    document.getElementById('message-objet').textContent = m.objet_libelle;
    document.getElementById('message-texte').textContent = m.message; // texte d'un visiteur : jamais innerHTML
    document.getElementById('message-repondre').href =
      `mailto:${m.email}?subject=${encodeURIComponent(`Re : ${m.objet_libelle} — Para'Noel`)}`;
    document.getElementById('dialogue-message').showModal();
  }

  async function changer(m, action) {
    try {
      if (action === 'traiter') {
        await api(`/api/admin/messages/${m.id}`, { method: 'PATCH', body: { statut: 'traite' } });
        notifier('Message marqué comme traité');
      } else {
        if (!(await confirmer(`Supprimer le message de ${m.nom} ? Cette action est définitive.`, 'Supprimer'))) return;
        await api(`/api/admin/messages/${m.id}`, { method: 'DELETE' });
        notifier('Message supprimé');
      }
      charger();
      rafraichirStats();
    } catch (err) {
      notifier(err.message, 'erreur');
    }
  }

  document.getElementById('tbody-messages').addEventListener('click', (event) => {
    const bouton = event.target.closest('button[data-action]');
    if (!bouton) return;
    const m = messages.find((x) => String(x.id) === bouton.closest('tr').dataset.id);
    if (!m) return;
    if (bouton.dataset.action === 'voir') lire(m);
    else changer(m, bouton.dataset.action);
  });

  document.getElementById('filtre-messages').addEventListener('change', charger);
  document.addEventListener('admin:section', (e) => { if (e.detail.id === 'messages') charger(); });
})();
