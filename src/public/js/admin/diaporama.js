// Diaporama de la section « Notre histoire » (accueil et À propos) : GET /api/public/accueil-photos.
// Aucune photo ajoutée : l'image déjà présente dans la page reste telle quelle.
// Une seule photo : affichée seule. Plusieurs : défilement automatique, flèches, points, glisser au doigt.
(function () {
  const cadre = document.querySelector('[data-diaporama]');
  if (!cadre) return;

  function element(balise, classe) {
    const el = document.createElement(balise);
    if (classe) el.className = classe;
    return el;
  }

  fetch('/api/public/accueil-photos')
    .then((res) => (res.ok ? res.json() : []))
    .then((photos) => {
      if (!photos.length) return;

      const diapos = photos.map((p, i) => {
        const img = element('img', 'diaporama__image');
        img.src = p.image;
        img.alt = p.legende || "L'ambiance de Para'Noel";
        img.width = 560;
        img.height = 420;
        img.loading = i === 0 ? 'eager' : 'lazy';
        return img;
      });

      const piste = element('div', 'diaporama__piste');
      diapos.forEach((img) => piste.appendChild(img));
      cadre.replaceChildren(piste);
      cadre.classList.add('diaporama--actif');

      if (photos.length === 1) return;

      let courant = 0;
      let minuteur = null;
      const legende = element('p', 'diaporama__legende');
      legende.setAttribute('aria-live', 'polite');
      const points = element('div', 'diaporama__points');
      const boutonsPoints = photos.map((_, i) => {
        const b = element('button', 'diaporama__point');
        b.type = 'button';
        b.setAttribute('aria-label', `Photo ${i + 1} sur ${photos.length}`);
        b.addEventListener('click', () => { aller(i); relancer(); });
        points.appendChild(b);
        return b;
      });

      function fleche(sens, texte, libelle) {
        const b = element('button', `diaporama__fleche diaporama__fleche--${sens}`);
        b.type = 'button';
        b.textContent = texte;
        b.setAttribute('aria-label', libelle);
        b.addEventListener('click', () => { aller(courant + (sens === 'suivant' ? 1 : -1)); relancer(); });
        return b;
      }

      function aller(i) {
        courant = (i + photos.length) % photos.length;
        piste.style.transform = `translateX(-${courant * 100}%)`;
        diapos.forEach((img, n) => { img.setAttribute('aria-hidden', n === courant ? 'false' : 'true'); });
        boutonsPoints.forEach((b, n) => { b.setAttribute('aria-current', n === courant ? 'true' : 'false'); });
        legende.textContent = photos[courant].legende;
        legende.hidden = !photos[courant].legende;
      }

      const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function arreter() { clearInterval(minuteur); minuteur = null; }
      function relancer() {
        arreter();
        if (!reduit) minuteur = setInterval(() => aller(courant + 1), 5000);
      }

      cadre.append(fleche('precedent', '‹', 'Photo précédente'), fleche('suivant', '›', 'Photo suivante'), legende, points);
      cadre.addEventListener('mouseenter', arreter);
      cadre.addEventListener('mouseleave', relancer);
      cadre.addEventListener('focusin', arreter);
      cadre.addEventListener('focusout', relancer);
      cadre.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { aller(courant - 1); relancer(); }
        if (e.key === 'ArrowRight') { aller(courant + 1); relancer(); }
      });

      // Glisser au doigt
      let departX = null;
      cadre.addEventListener('touchstart', (e) => { departX = e.touches[0].clientX; arreter(); }, { passive: true });
      cadre.addEventListener('touchend', (e) => {
        if (departX !== null) {
          const ecart = e.changedTouches[0].clientX - departX;
          if (Math.abs(ecart) > 40) aller(courant + (ecart < 0 ? 1 : -1));
        }
        departX = null;
        relancer();
      });

      aller(0);
      relancer();
    })
    .catch(() => { /* diaporama facultatif : l'image par défaut reste affichée */ });
})();