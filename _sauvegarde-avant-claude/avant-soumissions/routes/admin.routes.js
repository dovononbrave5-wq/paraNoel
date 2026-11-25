// API du tableau de bord d'administration. Montée sur /api/admin dans app.js.
// Toutes les routes exigent le rôle « admin » ou « super_admin » ;
// celles marquées SUPER exigent « super_admin » (le masquage dans la page n'est qu'un confort).
const express = require('express');
const db = require('../config/db');
const User = require('../models/user.model');
const Evenement = require('../models/evenement.model');
const Galerie = require('../models/galerie.model');
const Jeux = require('../models/jeux.model');
const Paiements = require('../models/paiements.model');
const Contenus = require('../models/contenus.model');
const Journal = require('../models/journal.model');
const upload = require('../middlewares/upload');
const { requireRole } = require('../middlewares/roles');
const { nommerAdminRules, evenementRules, handleValidation } = require('../middlewares/validate');
const { journaliser } = require('../utils/journal');
const { libelle, ouiNon, LIBELLES } = require('../utils/libelles');

const router = express.Router();
const SUPER = requireRole('super_admin');

router.use(requireRole('admin', 'super_admin'));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// --- Petits outils ---
const estSuper = (req) => req.user.role === 'super_admin';
const entierPositif = (valeur) => {
  const n = Number.parseInt(valeur, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const page = (req) => entierPositif(req.query.page) || 1;
const texteFiltre = (valeur, max = 100) => (typeof valeur === 'string' ? valeur.trim().slice(0, max) : '');
const dateFiltre = (valeur) => (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valeur) ? valeur : '');
const introuvable = (res, quoi = 'Élément') => res.status(404).json({ error: `${quoi} introuvable` });

// Actions qu'un simple administrateur voit dans « Activité récente » (pas les connexions ni les rôles)
const ACTIONS_ADMIN = ['contenu', 'message', 'jeu', 'paiement'];

const ligneJournal = (l) => ({
  id: l.id,
  date: l.date,
  utilisateur: l.email || 'Visiteur',
  action: l.action,
  action_libelle: libelle('action', l.action),
  detail: l.detail || '',
  ip: l.ip || ''
});

/* =====================================================================
   VUE D'ENSEMBLE
   ===================================================================== */
router.get('/stats', async (req, res, next) => {
  try {
    const [stats, [[messages]], [[jeuxOuverts]], paiements, activite] = await Promise.all([
      User.stats(),
      db.execute("SELECT COUNT(*) AS n FROM messages_contact WHERE statut = 'nouveau'"),
      db.execute("SELECT COUNT(*) AS n FROM jeux WHERE statut = 'publie' AND NOW() BETWEEN date_ouverture AND date_cloture"),
      Paiements.totaux(),
      Journal.recents(8, estSuper(req) ? null : ACTIONS_ADMIN)
    ]);

    const reponse = {
      ...stats,
      messages: Number(messages.n),
      jeux_ouverts: Number(jeuxOuverts.n),
      participants: paiements.nombre,
      recettes: paiements.recettes,
      recettes_libelle: Jeux.prixLisible(paiements.recettes),
      activite: activite.map((l) => ({
        date: l.date,
        libelle: `${libelle('action', l.action)} — ${l.email || 'Visiteur'}${l.detail ? ` : ${l.detail}` : ''}`
      }))
    };
    // Les e-mails des inscrits ne sont montrés qu'au super-administrateur
    if (estSuper(req)) {
      reponse.derniers_inscrits = (await User.lastUsers(5)).map((u) => ({
        ...u, verifie_libelle: ouiNon(u.is_verified)
      }));
    }
    res.json(reponse);
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   INSCRITS ET RÔLES (SUPER)
   ===================================================================== */
function methode(u) {
  const liste = [];
  if (u.a_mot_de_passe) liste.push('E-mail');
  if (u.a_google) liste.push('Google');
  return liste.join(', ') || '–';
}

router.get('/utilisateurs', SUPER, async (req, res, next) => {
  try {
    const filtres = {
      recherche: texteFiltre(req.query.recherche),
      role: Object.keys(LIBELLES.role).includes(req.query.role) ? req.query.role : '',
      statut: ['verifie', 'non-verifie', 'suspendu'].includes(req.query.statut) ? req.query.statut : ''
    };
    const parPage = 20;
    const numero = page(req);
    const { lignes, total } = await User.listUsers(filtres, numero, parPage);

    res.json({
      page: numero,
      pages: Math.max(1, Math.ceil(total / parPage)),
      total,
      utilisateurs: lignes.map((u) => ({
        id: u.id,
        email: u.email,
        date_inscription: u.date_inscription,
        derniere_connexion: u.derniere_connexion,
        methode: methode(u),
        is_verified: Boolean(u.is_verified),
        verifie_libelle: ouiNon(u.is_verified),
        role: u.role,
        role_libelle: libelle('role', u.role),
        statut: u.statut,
        statut_libelle: libelle('statutCompte', u.statut),
        est_moi: u.id === req.user.id
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Nommer administrateur depuis l'e-mail d'un inscrit
router.post('/administrateurs', SUPER, nommerAdminRules, handleValidation, async (req, res, next) => {
  try {
    const cible = await User.findByEmail(req.body.email);
    if (!cible) return res.status(404).json({ errors: [{ champ: 'email', message: 'Aucun inscrit avec cet e-mail' }] });
    if (cible.role !== 'membre') {
      return res.status(409).json({ errors: [{ champ: 'email', message: `Ce compte est déjà ${libelle('role', cible.role).toLowerCase()}` }] });
    }
    if (!cible.is_verified) return res.status(409).json({ errors: [{ champ: 'email', message: "L'e-mail de ce compte n'est pas encore vérifié" }] });
    if (cible.statut !== 'actif') return res.status(409).json({ errors: [{ champ: 'email', message: 'Ce compte est suspendu' }] });

    await User.setRole(cible.id, 'admin');
    await journaliser(req, 'role', `${cible.email} nommé administrateur`);
    res.json({ message: `${cible.email} est maintenant administrateur.` });
  } catch (err) {
    next(err);
  }
});

// Règles communes : on ne modifie ni soi-même, ni le super-administrateur
async function cibleModifiable(req, res) {
  const id = entierPositif(req.params.id);
  const cible = id && await User.findById(id);
  if (!cible) { introuvable(res, 'Utilisateur'); return null; }
  if (cible.id === req.user.id) { res.status(403).json({ error: 'Vous ne pouvez pas modifier votre propre compte.' }); return null; }
  if (cible.role === 'super_admin') { res.status(403).json({ error: 'Le super-administrateur ne peut pas être modifié.' }); return null; }
  return cible;
}

router.patch('/utilisateurs/:id/role', SUPER, async (req, res, next) => {
  try {
    const role = req.body?.role;
    if (!['admin', 'membre'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
    const cible = await cibleModifiable(req, res);
    if (!cible) return;
    if (role === 'admin' && (!cible.is_verified || cible.statut !== 'actif')) {
      return res.status(409).json({ error: 'Seul un compte vérifié et actif peut devenir administrateur.' });
    }

    await User.setRole(cible.id, role);
    await journaliser(req, 'role', role === 'admin'
      ? `${cible.email} nommé administrateur`
      : `${cible.email} n'est plus administrateur`);
    res.json({ message: role === 'admin' ? `${cible.email} est maintenant administrateur.` : `${cible.email} est de nouveau membre.` });
  } catch (err) {
    next(err);
  }
});

router.patch('/utilisateurs/:id/statut', SUPER, async (req, res, next) => {
  try {
    const statut = req.body?.statut;
    if (!['actif', 'suspendu'].includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
    const cible = await cibleModifiable(req, res);
    if (!cible) return;

    await User.setStatut(cible.id, statut);
    // Un compte suspendu est déconnecté à sa prochaine requête (passport.deserializeUser)
    await journaliser(req, 'compte', statut === 'suspendu' ? `${cible.email} suspendu` : `${cible.email} réactivé`);
    res.json({ message: statut === 'suspendu' ? `Le compte ${cible.email} est suspendu.` : `Le compte ${cible.email} est réactivé.` });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   INFORMATIONS DE L'ÉVÉNEMENT (SUPER)
   ===================================================================== */
router.get('/evenement', SUPER, async (req, res, next) => {
  try {
    const evenement = await Evenement.lire();
    delete evenement.modifie_par;
    res.json(evenement);
  } catch (err) {
    next(err);
  }
});

router.put('/evenement', SUPER, upload.image('image_apropos'), evenementRules, handleValidation, async (req, res, next) => {
  try {
    const avant = await Evenement.lire();
    const valeurs = {};
    Evenement.CHAMPS.forEach((champ) => {
      const v = req.body[champ];
      valeurs[champ] = typeof v === 'string' || typeof v === 'number' ? v : '';
    });

    await Evenement.modifier(valeurs, req.chiffres || [], req.file?.cheminPublic, req.user.id);
    if (req.file) upload.supprimerImagePublique(avant.image_apropos);
    await journaliser(req, 'contenu', "Informations de l'événement modifiées");

    const apres = await Evenement.lire();
    delete apres.modifie_par;
    res.json({ message: 'Informations enregistrées. Elles sont visibles sur le site.', evenement: apres });
  } catch (err) {
    if (req.file) upload.supprimerFichier(req.file.path);
    next(err);
  }
});

/* =====================================================================
   CONTENUS SIMPLES : annonces
   GET /:ressource  POST /:ressource  PUT /:ressource/:id  DELETE /:ressource/:id
   ===================================================================== */
Object.entries(Contenus.RESSOURCES).forEach(([ressource, config]) => {
  const roles = requireRole(...config.roles);
  const envoi = upload.image(config.image, { svg: config.svg });
  const nomDe = (element) => `${config.nom} « ${element[config.titre]} »`;

  // Vérifie le formulaire ; en cas d'erreur, supprime l'image qui vient d'arriver
  function verifier(req, res) {
    const { valeurs, erreurs } = Contenus.valider(ressource, req.body);
    if (erreurs.length) {
      if (req.file) upload.supprimerFichier(req.file.path);
      res.status(400).json({ errors: erreurs });
      return null;
    }
    if (req.file) valeurs[config.image] = req.file.cheminPublic;
    return valeurs;
  }

  function erreurDoublon(err, req, res) {
    if (req.file) upload.supprimerFichier(req.file.path);
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Cet élément existe déjà' });
      return true;
    }
    return false;
  }

  router.get(`/${ressource}`, roles, async (req, res, next) => {
    try {
      res.json(await Contenus.lister(ressource));
    } catch (err) {
      next(err);
    }
  });

  router.post(`/${ressource}`, roles, envoi, async (req, res, next) => {
    try {
      const valeurs = verifier(req, res);
      if (!valeurs) return;
      const id = await Contenus.creer(ressource, valeurs);
      const element = await Contenus.trouver(ressource, id);
      await journaliser(req, 'contenu', `${nomDe(element)} ajouté(e)`);
      res.status(201).json({ message: `${config.nom} ajouté(e).`, element });
    } catch (err) {
      if (!erreurDoublon(err, req, res)) next(err);
    }
  });

  router.put(`/${ressource}/:id`, roles, envoi, async (req, res, next) => {
    try {
      const id = entierPositif(req.params.id);
      const avant = id && await Contenus.trouver(ressource, id);
      if (!avant) {
        if (req.file) upload.supprimerFichier(req.file.path);
        return introuvable(res);
      }
      const valeurs = verifier(req, res);
      if (!valeurs) return;

      await Contenus.modifier(ressource, id, valeurs);
      if (req.file) upload.supprimerImagePublique(avant[config.image]); // l'ancienne image est remplacée
      const element = await Contenus.trouver(ressource, id);
      await journaliser(req, 'contenu', `${nomDe(element)} modifié(e)`);
      res.json({ message: 'Modifications enregistrées.', element });
    } catch (err) {
      if (!erreurDoublon(err, req, res)) next(err);
    }
  });

  router.delete(`/${ressource}/:id`, roles, async (req, res, next) => {
    try {
      const id = entierPositif(req.params.id);
      const element = id && await Contenus.trouver(ressource, id);
      if (!element) return introuvable(res);

      await Contenus.supprimer(ressource, id);
      if (config.image) upload.supprimerImagePublique(element[config.image]);
      await journaliser(req, 'contenu', `${nomDe(element)} supprimé(e)`);
      res.json({ message: `${config.nom} supprimé(e).` });
    } catch (err) {
      next(err);
    }
  });
});

/* =====================================================================
   MESSAGES DE CONTACT
   ===================================================================== */
router.get('/messages', async (req, res, next) => {
  try {
    const statut = ['nouveau', 'traite'].includes(req.query.statut) ? req.query.statut : '';
    const [lignes] = await db.execute(
      `SELECT id, nom, email, telephone, objet, message, statut, date FROM messages_contact
       ${statut ? 'WHERE statut = ?' : ''} ORDER BY date DESC, id DESC LIMIT 200`,
      statut ? [statut] : []
    );
    res.json(lignes.map((m) => ({
      ...m,
      objet_libelle: libelle('objet', m.objet),
      statut_libelle: libelle('statutMessage', m.statut)
    })));
  } catch (err) {
    next(err);
  }
});

router.patch('/messages/:id', async (req, res, next) => {
  try {
    const statut = req.body?.statut;
    if (!['nouveau', 'traite'].includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
    const id = entierPositif(req.params.id);
    const [[message]] = await db.execute('SELECT id, nom FROM messages_contact WHERE id = ?', [id]);
    if (!message) return introuvable(res, 'Message');

    await db.execute('UPDATE messages_contact SET statut = ? WHERE id = ?', [statut, id]);
    await journaliser(req, 'message', `Message de ${message.nom} marqué ${libelle('statutMessage', statut).toLowerCase()}`);
    res.json({ message: 'Message mis à jour.' });
  } catch (err) {
    next(err);
  }
});

router.delete('/messages/:id', async (req, res, next) => {
  try {
    const id = entierPositif(req.params.id);
    const [[message]] = await db.execute('SELECT id, nom FROM messages_contact WHERE id = ?', [id]);
    if (!message) return introuvable(res, 'Message');

    await db.execute('DELETE FROM messages_contact WHERE id = ?', [id]);
    await journaliser(req, 'message', `Message de ${message.nom} supprimé`);
    res.json({ message: 'Message supprimé.' });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   GALERIE DES ÉDITIONS PASSÉES (super-administrateur)
   ===================================================================== */
router.get('/galerie', SUPER, async (req, res, next) => {
  try {
    res.json(await Galerie.listerParEdition());
  } catch (err) {
    next(err);
  }
});

router.post('/galerie', SUPER, upload.images('photos', 20), async (req, res, next) => {
  const photos = req.images || [];
  const annuler = () => photos.forEach(upload.supprimerImagePublique);
  try {
    const edition = Number.parseInt(req.body.edition, 10);
    const annee = req.body.annee ? Number.parseInt(req.body.annee, 10) : null;
    const legende = String(req.body.legende || '').trim();
    const erreurs = [];
    if (!Number.isInteger(edition) || edition < 1 || edition > 99) erreurs.push({ champ: 'edition', message: "Numéro d'édition : entre 1 et 99" });
    if (annee !== null && (!Number.isInteger(annee) || annee < 2000 || annee > 2100)) erreurs.push({ champ: 'annee', message: 'Année invalide' });
    if (legende.length > 150) erreurs.push({ champ: 'legende', message: 'Légende : 150 caractères maximum' });
    if (!photos.length) erreurs.push({ champ: 'photos', message: 'Choisissez au moins une photo' });
    if (erreurs.length) { annuler(); return res.status(400).json({ errors: erreurs }); }

    await Galerie.ajouter({ edition, annee, legende }, photos);
    await journaliser(req, 'contenu', `${photos.length} photo(s) ajoutée(s) à la galerie (${edition}e édition)`);
    res.status(201).json({ message: `${photos.length} photo${photos.length > 1 ? 's ajoutées' : ' ajoutée'} à la galerie.` });
  } catch (err) {
    annuler();
    next(err);
  }
});

router.delete('/galerie/:id', SUPER, async (req, res, next) => {
  try {
    const id = entierPositif(req.params.id);
    const photo = id && await Galerie.trouver(id);
    if (!photo) return introuvable(res, 'Photo');
    await Galerie.supprimer(photo.id);
    upload.supprimerImagePublique(photo.image);
    await journaliser(req, 'contenu', `Photo retirée de la galerie (${photo.edition}e édition)`);
    res.json({ message: 'Photo supprimée.' });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   JEUX CONCOURS : jeux, questions, participants, rencontre en présentiel
   ===================================================================== */
const jeuDe = async (req, res) => {
  const id = entierPositif(req.params.id);
  const jeu = id && await Jeux.trouver(id);
  if (!jeu) introuvable(res, 'Jeu');
  return jeu || null;
};

router.get('/jeux', async (req, res, next) => {
  try {
    res.json(await Jeux.lister());
  } catch (err) {
    next(err);
  }
});

// Supprime les fichiers envoyés avec une demande refusée
const nettoyerEnvois = (req) => {
  if (req.file) upload.supprimerFichier(req.file.path);
  if (req.pdf) upload.supprimerFichier(req.pdf.chemin);
};

router.post('/jeux', upload.imageEtPdf(), async (req, res, next) => {
  try {
    const { valeurs, erreurs } = Jeux.validerJeu(req.body);
    if (erreurs.length) {
      nettoyerEnvois(req);
      return res.status(400).json({ errors: erreurs });
    }
    const id = await Jeux.creer(valeurs, req.file?.cheminPublic, req.pdf);
    await journaliser(req, 'contenu', `Jeu « ${valeurs.titre} » créé${req.pdf ? ' (avec formulaire PDF)' : ''}`);
    res.status(201).json({ message: 'Jeu créé. Ajoutez maintenant ses questions.', element: await Jeux.trouver(id) });
  } catch (err) {
    nettoyerEnvois(req);
    next(err);
  }
});

router.put('/jeux/:id', upload.imageEtPdf(), async (req, res, next) => {
  try {
    const avant = await jeuDe(req, res);
    if (!avant) { nettoyerEnvois(req); return; }
    const { valeurs, erreurs } = Jeux.validerJeu(req.body);
    if (erreurs.length) {
      nettoyerEnvois(req);
      return res.status(400).json({ errors: erreurs });
    }
    // Le prix ne change plus une fois que des joueurs ont payé (équité entre participants)
    if (valeurs.prix !== avant.prix && await Jeux.compterParticipations(avant.id) > 0) {
      nettoyerEnvois(req);
      return res.status(409).json({ errors: [{ champ: 'prix', message: 'Des joueurs ont déjà payé : le prix ne peut plus changer' }] });
    }
    // Formulaire PDF : nouveau fichier, retrait demandé (case cochée), ou inchangé
    const retirer = ['on', 'true', '1'].includes(String(req.body.retirer_formulaire || '').toLowerCase());
    const formulaire = req.pdf || (retirer ? null : undefined);

    await Jeux.modifier(avant.id, valeurs, req.file?.cheminPublic, formulaire);
    if (req.file) upload.supprimerImagePublique(avant.image);
    if (formulaire !== undefined && avant.formulaire_pdf) upload.supprimerFormulaire(avant.formulaire_pdf);

    const details = [];
    if (valeurs.rencontre_publiee && !avant.rencontre_publiee) details.push('rencontre en présentiel publiée');
    if (req.pdf) details.push('formulaire PDF ajouté');
    else if (formulaire === null && avant.formulaire_pdf) details.push('formulaire PDF retiré');
    await journaliser(req, 'contenu', `Jeu « ${valeurs.titre} » modifié${details.length ? ` (${details.join(', ')})` : ''}`);
    res.json({ message: 'Modifications enregistrées.', element: await Jeux.trouver(avant.id) });
  } catch (err) {
    nettoyerEnvois(req);
    next(err);
  }
});

// Voir le formulaire PDF d'un jeu (administration seulement : le dossier n'est pas public)
router.get('/jeux/:id/formulaire', async (req, res, next) => {
  try {
    const jeu = await jeuDe(req, res);
    if (!jeu) return;
    const chemin = upload.cheminFormulaire(jeu.formulaire_pdf);
    if (!chemin) return res.status(404).json({ error: 'Ce jeu n\'a pas de formulaire PDF' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(jeu.formulaire_nom || 'formulaire.pdf')}`);
    res.sendFile(chemin, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'Fichier PDF introuvable' }); });
  } catch (err) {
    next(err);
  }
});

router.delete('/jeux/:id', async (req, res, next) => {
  try {
    const jeu = await jeuDe(req, res);
    if (!jeu) return;
    if (await Jeux.compterParticipations(jeu.id) > 0) {
      return res.status(409).json({ error: 'Des joueurs ont payé pour ce jeu : il ne peut pas être supprimé. Passez-le en brouillon pour le masquer.' });
    }
    await Jeux.supprimer(jeu.id);
    upload.supprimerImagePublique(jeu.image);
    upload.supprimerFormulaire(jeu.formulaire_pdf);
    await journaliser(req, 'contenu', `Jeu « ${jeu.titre} » supprimé`);
    res.json({ message: 'Jeu supprimé.' });
  } catch (err) {
    next(err);
  }
});

// Questions avec les bonnes réponses : réservé à l'administration
router.get('/jeux/:id/questions', async (req, res, next) => {
  try {
    const jeu = await jeuDe(req, res);
    if (!jeu) return;
    res.json({ verrouille: await Jeux.compterParticipations(jeu.id, { commencees: true }) > 0, questions: await Jeux.lireQuestions(jeu.id, { avecReponses: true }) });
  } catch (err) {
    next(err);
  }
});

router.put('/jeux/:id/questions', async (req, res, next) => {
  try {
    const jeu = await jeuDe(req, res);
    if (!jeu) return;
    if (await Jeux.compterParticipations(jeu.id, { commencees: true }) > 0) {
      return res.status(409).json({ error: 'Des joueurs ont déjà commencé : les questions ne peuvent plus être modifiées.' });
    }
    const { questions, erreurs } = Jeux.validerQuestions(req.body?.questions);
    if (erreurs.length) return res.status(400).json({ errors: erreurs });
    await Jeux.remplacerQuestions(jeu.id, questions);
    await journaliser(req, 'contenu', `Questionnaire de « ${jeu.titre} » enregistré (${questions.length} questions)`);
    res.json({ message: `${questions.length} question${questions.length > 1 ? 's' : ''} enregistrée${questions.length > 1 ? 's' : ''}.` });
  } catch (err) {
    next(err);
  }
});

// Classement des participants : meilleur score, puis le plus rapide
router.get('/jeux/:id/participations', async (req, res, next) => {
  try {
    const jeu = await jeuDe(req, res);
    if (!jeu) return;
    res.json({ jeu: { id: jeu.id, titre: jeu.titre }, participations: await Jeux.listerParticipations(jeu.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/jeux/:id/retenir', async (req, res, next) => {
  try {
    const jeu = await jeuDe(req, res);
    if (!jeu) return;
    const nombre = Number(req.body?.nombre);
    if (!Number.isInteger(nombre) || nombre < 1 || nombre > 1000) return res.status(400).json({ errors: [{ champ: 'nombre', message: 'Nombre de participants retenus : entre 1 et 1000' }] });
    const { retenus, nonRetenus } = await Jeux.retenirMeilleurs(jeu.id, nombre);
    await journaliser(req, 'jeu', `« ${jeu.titre} » : ${retenus} participant(s) retenu(s) pour la rencontre`);
    res.json({ message: `${retenus} participant(s) retenu(s), ${nonRetenus} non retenu(s).` });
  } catch (err) {
    next(err);
  }
});

router.patch('/participations/:id', async (req, res, next) => {
  try {
    const resultat = req.body?.resultat;
    if (!Object.keys(LIBELLES.resultat).includes(resultat)) return res.status(400).json({ error: 'Résultat invalide' });
    const id = entierPositif(req.params.id);
    if (!id || !(await Jeux.changerResultat(id, resultat))) return introuvable(res, 'Participation');
    await journaliser(req, 'jeu', `Participation n° ${id} : ${libelle('resultat', resultat).toLowerCase()}`);
    res.json({ message: 'Résultat enregistré.' });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   PAIEMENTS (lecture seule : l'argent est géré dans le tableau de bord KKiaPay)
   ===================================================================== */
router.get('/paiements', async (req, res, next) => {
  try {
    const jeuId = entierPositif(req.query.jeu) || undefined;
    res.json({ totaux: await Paiements.totaux(), paiements: await Paiements.lister({ statut: req.query.statut, jeuId }) });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   JOURNAL D'ACTIVITÉ (SUPER)
   ===================================================================== */
router.get('/journal', SUPER, async (req, res, next) => {
  try {
    const filtres = {
      action: Object.keys(LIBELLES.action).includes(req.query.action) ? req.query.action : '',
      utilisateur: texteFiltre(req.query.utilisateur),
      du: dateFiltre(req.query.du),
      au: dateFiltre(req.query.au)
    };
    const parPage = 25;
    const numero = page(req);
    const { lignes, total } = await Journal.lister(filtres, numero, parPage);
    res.json({ page: numero, pages: Math.max(1, Math.ceil(total / parPage)), total, entrees: lignes.map(ligneJournal) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
