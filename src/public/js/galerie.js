// Galerie des éditions passées (accueil et « À propos ») : GET /api/public/galerie.
// La section reste cachée tant qu'aucune photo n'a été ajoutée par le super-administrateur.
(function () {
  const section = document.querySelector('[data-galerie]');
  if (!section) return;
  const liste = section.querySelector('[data-galerie-liste]');
  const zoom = section.querySelector('[data-galerie-zoom]');

  function element(balise, texte, classe) {
    const el = document.createElement(balise);
    if (texte) el.textContent = texte;
    if (classe) el.className = classe;
    return el;
  }

  function agrandir(photo, titre) {
    const img = zoom.querySelector('img');
    img.src = photo.image;
    img.alt = photo.legende || titre;
    zoom.querySelector('.galerie-zoom__legende').textContent = photo.legende ? `${photo.legende} · ${titre}` : titre;
    zoom.showModal();
  }
  // Clic en dehors de la photo : fermeture
  zoom.addEventListener('click', (e) => { if (e.target === zoom) zoom.close(); });

  fetch('/api/public/galerie')
    .then((res) => (res.ok ? res.json() : []))
    .then((editions) => {
      if (!editions.length) return;
      editions.forEach((ed) => {
        const titre = `${ed.edition_libelle}${ed.annee ? ` · ${ed.annee}` : ''}`;
        const bloc = element('div', null, 'galerie__edition');
        bloc.appendChild(element('h3', titre, 'galerie__titre'));
        const grille = element('ul', null, 'galerie__grille');
        ed.photos.forEach((p) => {
          const li = element('li', null, 'galerie__photo');
          const bouton = element('button', null, 'galerie__bouton');
          bouton.type = 'button';
          bouton.setAttribute('aria-label', `Agrandir : ${p.legende || titre}`);
          const img = element('img');
          img.src = p.image;
          img.alt = p.legende || `Photo de la ${ed.edition_libelle}`;
          img.loading = 'lazy';
          bouton.appendChild(img);
          bouton.addEventListener('click', () => agrandir(p, titre));
          li.appendChild(bouton);
          if (p.legende) li.appendChild(element('p', p.legende, 'galerie__legende'));
          grille.appendChild(li);
        });
        bloc.appendChild(grille);
        liste.appendChild(bloc);
      });
      section.hidden = false;
    })
    .catch(() => { /* galerie facultative : rien à afficher */ });
})();
