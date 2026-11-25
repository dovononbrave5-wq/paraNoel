// Enregistre une ligne dans le journal d'activité suivi par le super-administrateur.
// Ne lance jamais d'erreur : un problème de journal ne doit pas faire échouer l'action de l'utilisateur.
const Journal = require('../models/journal.model');

// Adresse IP du visiteur (avec « trust proxy », Express lit X-Forwarded-For)
const ipDe = (req) => (req?.ip || '').replace(/^::ffff:/, '').slice(0, 45) || null;

/**
 * journaliser(req, 'contenu', 'Service « Bâtiment » ajouté')
 * journaliser(req, 'connexion-echec', 'Mot de passe incorrect', { email })   ← utilisateur non connecté
 */
async function journaliser(req, action, detail = null, utilisateur = req?.user) {
  try {
    await Journal.ajouter({
      userId: utilisateur?.id || null,
      email: utilisateur?.email || null,
      action,
      detail: detail ? String(detail).slice(0, 1000) : null,
      ip: ipDe(req)
    });
  } catch (err) {
    console.error('Journal d\'activité : écriture impossible :', err.message);
  }
}

module.exports = { journaliser, ipDe };
