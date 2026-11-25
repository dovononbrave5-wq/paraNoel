// Rubrique « Paiements » : liste des paiements Mobile Money (lecture seule) et total encaissé.
(function () {
  const { api, remplir } = window.Admin;
  const $ = (id) => document.getElementById(id);
  const format = new Intl.NumberFormat('fr-FR');

  async function charger() {
    const tbody = $('tbody-paiements');
    const etat = $('etat-paiements');
    const statut = $('filtre-paiements').value;
    etat.hidden = false;
    etat.textContent = 'Chargement…';
    try {
      const data = await api(`/api/admin/paiements${statut ? `?statut=${statut}` : ''}`);
      $('paiements-nombre').textContent = format.format(data.totaux.nombre);
      $('paiements-recettes').textContent = `${format.format(data.totaux.recettes)} FCFA`;
      tbody.textContent = '';
      data.paiements.forEach((p) => {
        const fragment = remplir($('modele-paiement'), p);
        const badge = fragment.querySelector('.badge');
        badge.classList.add(`paiement-${p.statut}`);
        if (p.motif_echec) badge.title = p.motif_echec;
        tbody.appendChild(fragment);
      });
      etat.hidden = data.paiements.length > 0;
      etat.textContent = 'Aucun paiement dans cette catégorie.';
    } catch (err) {
      etat.textContent = `Chargement impossible : ${err.message}`;
    }
  }

  $('filtre-paiements').addEventListener('change', charger);
  document.addEventListener('admin:section', (e) => { if (e.detail.id === 'paiements') charger(); });
})();
