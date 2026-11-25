// Textes affichés à la place des valeurs techniques enregistrées en base
const LIBELLES = {
  typeAnnonce: { 'actualite': 'Actualité', 'programme': 'Programme', 'jeu': 'Jeu concours', 'resultats': 'Résultats' },
  statutAnnonce: { 'brouillon': 'Brouillon', 'publiee': 'Publiée' },
  objet: {
    'information': 'Demande d\'information', 'jeu-concours': 'Jeu concours',
    'paiement': 'Problème de paiement', 'partenariat': 'Partenariat, sponsoring',
    'benevolat': 'Bénévolat', 'autre': 'Autre demande'
  },
  statutMessage: { 'nouveau': 'Nouveau', 'traite': 'Traité' },
  statutJeu: { 'brouillon': 'Brouillon', 'publie': 'Publié' },
  phaseJeu: { 'a-venir': 'Bientôt', 'ouvert': 'Ouvert', 'clos': 'Clôturé' },
  statutPaiement: { 'en_attente': 'En attente', 'reussi': 'Réussi', 'echoue': 'Échoué' },
  statutParticipation: { 'payee': 'Payée, questionnaire non commencé', 'en_cours': 'Questionnaire en cours', 'terminee': 'Questionnaire terminé' },
  resultat: { 'en_attente': 'En attente', 'retenu': 'Retenu pour la rencontre', 'non_retenu': 'Non retenu' },
  role: { 'membre': 'Membre', 'admin': 'Administrateur', 'super_admin': 'Super-administrateur' },
  statutCompte: { 'actif': 'Actif', 'suspendu': 'Suspendu' },
  action: {
    'inscription': 'Inscription', 'connexion': 'Connexion', 'connexion-echec': 'Connexion échouée',
    'deconnexion': 'Déconnexion', 'role': 'Rôle', 'compte': 'Compte', 'contenu': 'Contenu',
    'message': 'Message', 'jeu': 'Jeu concours', 'paiement': 'Paiement'
  }
};

// libelle('typeAnnonce', 'jeu') → 'Jeu concours' ; valeur inconnue → la valeur elle-même
const libelle = (liste, valeur) => (valeur == null ? '' : (LIBELLES[liste][valeur] || String(valeur)));
const ouiNon = (valeur) => (valeur ? 'Oui' : 'Non');

module.exports = { LIBELLES, libelle, ouiNon };
