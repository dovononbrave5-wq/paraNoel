// Filtres des pages Jeux et Annonces.
// Chaque bouton [data-filtre] est comparé au data-categorie des éléments de #liste-filtrable
// (data-categorie est posé par listes.js depuis data-categorie-depuis).
// Un lien direct est possible : /jeux?filtre=ouvert ou /annonces?filtre=programme
(function () {
  const boutons = [...document.querySelectorAll('.filtre[data-filtre]')];
  const liste = document.getElementById('liste-filtrable');
  const aucunResultat = document.getElementById('aucun-resultat');
  if (!boutons.length || !liste) return;

  let filtreActif = 'tous';

  function appliquer() {
    const elements = [...liste.children];
    let visibles = 0;
    elements.forEach((el) => {
      const montre = filtreActif === 'tous' || el.dataset.categorie === filtreActif;
      el.hidden = !montre;
      if (montre) visibles++;
    });
    // « Aucun résultat » seulement si la liste contient des éléments, mais aucun dans ce filtre
    if (aucunResultat) aucunResultat.hidden = !(elements.length && visibles === 0);
  }

  function choisir(filtre) {
    if (!boutons.some((b) => b.dataset.filtre === filtre)) filtre = 'tous';
    filtreActif = filtre;
    boutons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filtre === filtre)));
    appliquer();
  }

  boutons.forEach((bouton) => {
    bouton.addEventListener('click', () => {
      choisir(bouton.dataset.filtre);
      // L'adresse garde le filtre (partage du lien, bouton « retour » du navigateur)
      const url = new URL(location.href);
      if (filtreActif === 'tous') url.searchParams.delete('filtre');
      else url.searchParams.set('filtre', filtreActif);
      history.replaceState(null, '', url);
    });
  });

  // La liste arrive après le chargement de la page : on filtre dès qu'elle est prête
  document.addEventListener('liste:chargee', appliquer);
  choisir(new URLSearchParams(location.search).get('filtre') || 'tous');
})();
