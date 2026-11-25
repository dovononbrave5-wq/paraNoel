// Envoie un e-mail de test et affiche la raison exacte en cas d'échec.
// Usage :  npm run tester-email -- ton@adresse.com
require('dotenv').config();
const { sendVerificationEmail, verifierConfiguration } = require('../src/config/mailer');

const destinataire = process.argv[2] || process.env.BREVO_SENDER_EMAIL;
if (!destinataire) {
  console.error('Indiquez une adresse : npm run tester-email -- ton@adresse.com');
  process.exit(1);
}

(async () => {
  verifierConfiguration();
  console.log(`Envoi d'un e-mail de test à ${destinataire}…`);
  try {
    await sendVerificationEmail(destinataire, `${process.env.BASE_URL || 'http://localhost:3000'}/login`);
    console.log('✔ E-mail envoyé ! Regardez la boîte de réception (et les spams).');
  } catch (err) {
    console.error('✘ Échec :', err.message);
    const m = err.message.toLowerCase();
    if (m.includes('ip')) console.error('→ Brevo bloque votre adresse IP : Brevo → Paramètres → Sécurité → Adresses IP autorisées.');
    else if (m.includes('sender') || m.includes('expéditeur')) console.error('→ Validez BREVO_SENDER_EMAIL dans Brevo → Expéditeurs, domaines et IP dédiées.');
    else if (m.includes('401') || m.includes('key')) console.error('→ Clé API invalide : régénérez-la dans Brevo → SMTP & API → Clés API.');
    else if (m.includes('fetch failed') || m.includes('timeout')) console.error('→ Pas d\'accès à api.brevo.com : vérifiez la connexion Internet, un pare-feu ou un antivirus.');
    process.exitCode = 1;
  }
  // Pas de process.exit() : Node s'arrête seul, ce qui évite l'erreur « Assertion failed » sous Windows
})();
