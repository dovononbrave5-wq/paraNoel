// Rubrique « Journal d'activité » (super-administrateur) : filtres et pagination.
(function () {
  const { api, remplir } = window.Admin;
  let page = 1;
  let pages = 1;

  async function charger() {
    const form = document.getElementById('filtres-journal');
    if (!form) return;
    const tbody = document.getElementById('tbody-journal');
    const etat = document.getElementById('etat-journal');
    const params = new URLSearchParams(new FormData(form));
    params.set('page', page);
    etat.hidden = false;
    etat.textContent = 'Chargement…';
    try {
      const data = await api(`/api/admin/journal?${params}`);
      pages = data.pages;
      tbody.textContent = '';
      data.entrees.forEach((entree) => {
        const fragment = remplir(document.getElementById('modele-journal'), entree);
        const badge = fragment.querySelector('.badge');
        if (entree.action === 'connexion-echec') badge.classList.add('badge--danger');
        if (['role', 'compte'].includes(entree.action)) badge.classList.add('badge--or');
        tbody.appendChild(fragment);
      });
      etat.hidden = data.entrees.length > 0;
      etat.textContent = 'Aucune activité ne correspond à ces critères.';
      document.getElementById('journal-info').textContent = `Page ${data.page} sur ${data.pages} · ${data.total} entrée${data.total > 1 ? 's' : ''}`;
      document.getElementById('journal-precedent').disabled = data.page <= 1;
      document.getElementById('journal-suivant').disabled = data.page >= data.pages;
    } catch (err) {
      etat.textContent = `Chargement impossible : ${err.message}`;
    }
  }

  document.addEventListener('admin:section', (e) => {
    if (e.detail.id === 'journal') { page = 1; charger(); }
  });

  window.Admin.pret.then(() => {
    const form = document.getElementById('filtres-journal');
    if (!form) return; // simple admin : rubrique retirée
    form.addEventListener('submit', (event) => { event.preventDefault(); page = 1; charger(); });
    document.getElementById('journal-action').addEventListener('change', () => { page = 1; charger(); });
    document.getElementById('journal-precedent').addEventListener('click', () => { if (page > 1) { page--; charger(); } });
    document.getElementById('journal-suivant').addEventListener('click', () => { if (page < pages) { page++; charger(); } });
  }).catch(() => {});
})();
