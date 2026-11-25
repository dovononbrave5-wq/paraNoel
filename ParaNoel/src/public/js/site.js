// Remplit les informations de l'événement saisies par le super-administrateur.
// Chaque élément [data-info="cle"] reçoit la valeur correspondante de GET /api/public/evenement.
//
//   data-lien="tel | mailto | whatsapp | url | src"  → crée le lien (ou la source d'une image / d'une carte)
//   data-garder-texte                                → garde le texte du lien (« Nous appeler »)
//   data-format="lignes | paragraphes"               → respecte les retours à la ligne
//   data-masquer-si-vide (avec hidden)               → l'élément ne s'affiche que si une valeur existe
//
// Tous les textes sont écrits avec textContent : une valeur ne peut jamais injecter du HTML.
(function () {
  // Petit cache partagé avec listes.js : /api/public/evenement n'est demandé qu'une fois par page
  const cache = {};
  window.chargerJSON = function (url) {
    if (!cache[url]) {
      cache[url] = fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then((res) => {
          if (!res.ok) throw new Error(`Erreur ${res.status}`);
          return res.json();
        });
    }
    return cache[url];
  };

  // Année du pied de page
  const annee = document.getElementById('annee');
  if (annee) annee.textContent = String(new Date().getFullYear());

  const elements = document.querySelectorAll('[data-info]');
  if (!elements.length) return;

  const estUrlWeb = (valeur) => /^https?:\/\//i.test(valeur);
  const estCheminLocal = (valeur) => /^\/(?!\/)/.test(valeur);
  const chiffresSeuls = (valeur) => valeur.replace(/[^\d+]/g, '');

  // Adresse du lien selon son type ; null si la valeur n'est pas sûre
  function adresse(type, valeur) {
    switch (type) {
      case 'tel': return `tel:${chiffresSeuls(valeur)}`;
      case 'mailto': return `mailto:${valeur}`;
      case 'whatsapp': return `https://wa.me/${valeur.replace(/\D/g, '')}`;
      case 'url': return estUrlWeb(valeur) ? valeur : null;
      case 'src': return estUrlWeb(valeur) || estCheminLocal(valeur) ? valeur : null;
      default: return null;
    }
  }

  function ecrireAvecRetours(element, valeur, format) {
    element.textContent = '';
    const lignes = String(valeur).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (format === 'paragraphes') {
      lignes.forEach((ligne) => {
        const p = document.createElement('p');
        p.textContent = ligne;
        element.appendChild(p);
      });
    } else {
      lignes.forEach((ligne, i) => {
        if (i > 0) element.appendChild(document.createElement('br'));
        element.appendChild(document.createTextNode(ligne));
      });
    }
  }

  function remplir(element, valeur) {
    const type = element.dataset.lien;

    if (type) {
      const lien = adresse(type, valeur);
      if (!lien) return false;
      if (type === 'src') {
        // La carte Google n'est chargée que si l'adresse est bien une carte intégrée (autorisée par Helmet)
        if (element.tagName === 'IFRAME' && !/^https:\/\/www\.google\.com\/maps\/embed\?/i.test(lien)) return false;
        element.src = lien;
        return true;
      }
      element.href = lien;
      if (!element.hasAttribute('data-garder-texte')) element.textContent = valeur;
      return true;
    }

    if (element.dataset.format) ecrireAvecRetours(element, valeur, element.dataset.format);
    else element.textContent = valeur;
    return true;
  }

  // Affiche un bloc [data-masquer-si-vide] : l'élément lui-même et ses parents masqués
  function afficher(element) {
    let courant = element;
    while (courant && courant !== document.body) {
      if (courant.hasAttribute('data-masquer-si-vide')) courant.hidden = false;
      courant = courant.parentElement;
    }
  }

  window.chargerJSON('/api/public/evenement')
    .then((evenement) => {
      elements.forEach((element) => {
        const valeur = evenement[element.dataset.info];
        if (valeur === null || valeur === undefined || String(valeur).trim() === '') return; // le texte par défaut reste
        if (remplir(element, String(valeur).trim())) afficher(element);
      });
    })
    .catch(() => { /* API indisponible : les textes par défaut de la page restent affichés */ });
})();
