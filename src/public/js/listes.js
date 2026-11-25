// Listes dynamiques (jeux, annonces, chiffres clés).
//
// <div class="liste-dynamique" data-source="/api/public/services" data-modele="modele-service" [data-cle="chiffres"]>
//   <ul data-liste></ul>                         ← les éléments sont ajoutés ici
//   <p data-etat="chargement | vide | erreur">    ← messages affichés selon le résultat
//   <template id="modele-service">…</template>   ← modèle cloné pour chaque élément
//
// Dans le modèle :
//   data-champ="cle"            texte de l'élément (ou src d'une image)
//   data-champ-date="cle"       date lisible (« 12 mars 2026 »)
//   data-champ-liste="cle"      une puce <li> par ligne du texte
//   data-alt="cle" / data-alt-depuis="cle"   texte alternatif d'une image
//   data-lien-depuis="cle"      href du lien ; lien masqué si la valeur est vide
//   data-ancre-depuis="cle"     ajoute #valeur au lien (/services#batiment)
//   data-id-depuis="cle"        id de l'élément (cible des liens /services#batiment)
//   data-categorie-depuis="cle" data-categorie (utilisé par filtres.js)
//   data-cible-depuis="cle"     data-cible (utilisé par compteurs.js)
//   data-classe-depuis="cle"    ajoute la classe « etat-<valeur> » (ex. etat-ouvert, pour la couleur d'un badge)
//   data-si="cle:valeur"        l'élément n'est gardé que si item[cle] === valeur (ex. bouton « Participer » si ouvert)
//   data-si-rempli="cle"        l'élément n'est gardé (et affiché) que si item[cle] a une valeur
//   data-avec-heure             sur data-champ-date : affiche aussi l'heure (« 20 décembre 2026 à 18:00 »)
// Une liste avec data-chargement-manuel n'est chargée que sur demande : window.listesDynamiques.charger(element)
(function () {
  const charger = window.chargerJSON || ((url) => fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Erreur ${r.status}`);
    return r.json();
  }));

  const vide = (v) => v === null || v === undefined || String(v).trim() === '';
  const lienSur = (v) => /^https?:\/\//i.test(v) || /^\/(?!\/)/.test(v);

  const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  // « 2026-03-12 00:00:00 » → objet Date (heure locale)
  const lireDate = (v) => new Date(String(v).replace(' ', 'T'));

  // Tous les éléments qui portent l'attribut, y compris la racine du modèle
  function avecAttribut(racines, attribut) {
    const resultat = [];
    racines.forEach((racine) => {
      if (racine.hasAttribute(attribut)) resultat.push(racine);
      resultat.push(...racine.querySelectorAll(`[${attribut}]`));
    });
    return resultat;
  }

  function remplirModele(modele, item) {
    const fragment = modele.content.cloneNode(true);
    const racines = [...fragment.children];

    // D'abord les conditions : un élément retiré n'a pas besoin d'être rempli
    avecAttribut(racines, 'data-si').forEach((el) => {
      const [cle, valeur] = el.dataset.si.split(':');
      if (String(item[cle]) !== valeur) el.remove();
    });
    avecAttribut(racines, 'data-si-rempli').forEach((el) => {
      if (vide(item[el.dataset.siRempli])) el.remove();
      else el.hidden = false;
    });

    avecAttribut(racines, 'data-champ').forEach((el) => {
      const valeur = item[el.dataset.champ];
      if (el.tagName === 'IMG') {
        if (!vide(valeur) && lienSur(valeur)) el.src = valeur; // sinon : image par défaut (logo)
        return;
      }
      if (!vide(valeur)) el.textContent = valeur;
      else if (!el.hasAttribute('data-lien-depuis')) el.textContent = ''; // un bouton garde son texte par défaut
    });

    avecAttribut(racines, 'data-champ-date').forEach((el) => {
      const valeur = item[el.dataset.champDate];
      const date = vide(valeur) ? null : lireDate(valeur);
      if (date && !Number.isNaN(date.getTime())) {
        el.textContent = el.hasAttribute('data-avec-heure') ? FORMAT_DATE_HEURE.format(date) : FORMAT_DATE.format(date);
        if (el.tagName === 'TIME') el.dateTime = String(valeur).slice(0, 10);
      }
    });

    avecAttribut(racines, 'data-champ-liste').forEach((el) => {
      el.textContent = '';
      String(item[el.dataset.champListe] || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .forEach((ligne) => {
          const li = document.createElement('li');
          li.textContent = ligne;
          el.appendChild(li);
        });
      if (!el.children.length) el.remove();
    });

    avecAttribut(racines, 'data-alt').forEach((el) => { el.alt = item[el.dataset.alt] || ''; });
    avecAttribut(racines, 'data-alt-depuis').forEach((el) => { el.alt = item[el.dataset.altDepuis] || ''; });

    avecAttribut(racines, 'data-lien-depuis').forEach((el) => {
      const valeur = item[el.dataset.lienDepuis];
      if (!vide(valeur) && lienSur(valeur)) {
        el.href = valeur;
        el.hidden = false;
        // Lien interne : même onglet ; lien externe : nouvel onglet sécurisé
        if (/^https?:\/\//i.test(valeur)) { el.target = '_blank'; el.rel = 'noopener'; }
        else { el.removeAttribute('target'); el.removeAttribute('rel'); }
      } else {
        el.remove();
      }
    });

    avecAttribut(racines, 'data-ancre-depuis').forEach((el) => {
      const ancre = item[el.dataset.ancreDepuis];
      if (!vide(ancre)) el.href = `${el.getAttribute('href').split('#')[0]}#${encodeURIComponent(ancre)}`;
    });
    avecAttribut(racines, 'data-id-depuis').forEach((el) => {
      const id = item[el.dataset.idDepuis];
      if (!vide(id)) el.id = String(id);
    });
    avecAttribut(racines, 'data-categorie-depuis').forEach((el) => {
      el.dataset.categorie = item[el.dataset.categorieDepuis] || '';
    });
    avecAttribut(racines, 'data-classe-depuis').forEach((el) => {
      const valeur = item[el.dataset.classeDepuis];
      if (!vide(valeur)) el.classList.add(`etat-${valeur}`);
    });
    avecAttribut(racines, 'data-cible-depuis').forEach((el) => {
      el.dataset.cible = item[el.dataset.cibleDepuis] ?? 0;
    });

    return fragment;
  }

  function etat(conteneur, nom) {
    conteneur.querySelectorAll('[data-etat]').forEach((el) => { el.hidden = el.dataset.etat !== nom; });
  }

  // Affiche les blocs parents marqués [data-masquer-si-vide] (ex. la bande des chiffres clés)
  function afficherParents(element) {
    let courant = element.parentElement;
    while (courant && courant !== document.body) {
      if (courant.hasAttribute('data-masquer-si-vide')) courant.hidden = false;
      courant = courant.parentElement;
    }
  }

  async function chargerListe(conteneur) {
    const modele = document.getElementById(conteneur.dataset.modele);
    const liste = conteneur.querySelector('[data-liste]');
    if (!modele || !liste) return;

    etat(conteneur, 'chargement');
    try {
      const donnees = await charger(conteneur.dataset.source);
      const elements = conteneur.dataset.cle ? donnees[conteneur.dataset.cle] : donnees;
      if (!Array.isArray(elements)) throw new Error('Réponse inattendue');

      liste.textContent = '';
      elements.forEach((item) => liste.appendChild(remplirModele(modele, item)));
      etat(conteneur, elements.length ? null : 'vide');
      if (elements.length) afficherParents(conteneur);

      // Prévenir filtres.js et compteurs.js que la liste est prête
      conteneur.dispatchEvent(new CustomEvent('liste:chargee', { bubbles: true, detail: { nombre: elements.length } }));
    } catch (err) {
      etat(conteneur, 'erreur');
    }
  }

  // Chargement à la demande (participer.js)
  window.listesDynamiques = { charger: chargerListe };

  const conteneurs = [...document.querySelectorAll('.liste-dynamique:not([data-chargement-manuel])')];
  Promise.all(conteneurs.map(chargerListe)).then(() => {
    // Lien direct vers un élément créé après le chargement (ex. /services#batiment)
    if (location.hash.length > 1) {
      const cible = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (cible) cible.scrollIntoView();
    }
  });
})();
