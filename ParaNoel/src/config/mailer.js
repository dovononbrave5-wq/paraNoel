const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true', // true pour le port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const VERT = '#0e3b2e';
const ROUGE = '#c8102e';
const OR = '#d4a24c';

// Les textes saisis par les visiteurs sont échappés avant d'être insérés dans le HTML de l'e-mail
function echapper(texte) {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const avecRetours = (texte) => echapper(texte).replace(/\r?\n/g, '<br>');

// Adresse qui reçoit les notifications du site
const destinataire = () => process.env.CONTACT_EMAIL || process.env.SMTP_USER;

function gabarit(titre, contenu) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e3e6ee;border-radius:8px;overflow:hidden">
    <div style="background:${VERT};color:#fff;padding:16px 24px;font-size:18px;font-weight:bold;border-bottom:4px solid ${ROUGE}">
      Para'Noel <span style="color:${OR}">★</span> ${echapper(titre)}
    </div>
    <div style="padding:24px;color:#3b3b3d;line-height:1.5">${contenu}</div>
  </div>`;
}

function tableau(lignes) {
  return `<table style="border-collapse:collapse;width:100%">${lignes
    .filter(([, valeur]) => valeur)
    .map(([nom, valeur]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7080;white-space:nowrap">${echapper(nom)}</td>
      <td style="padding:6px 0"><strong>${echapper(valeur)}</strong></td></tr>`)
    .join('')}</table>`;
}

async function sendVerificationEmail(to, link) {
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: 'Confirmez votre adresse e-mail',
    text: `Bienvenue ! Confirmez votre e-mail en ouvrant ce lien (valable 24 h) : ${link}`,
    html: gabarit('Confirmation de votre e-mail', `
      <p>Bienvenue sur Para'Noel !</p>
      <p>Cliquez sur le bouton pour confirmer votre adresse e-mail (lien valable 24 h) :</p>
      <p><a href="${echapper(link)}" style="display:inline-block;padding:10px 18px;background:${ROUGE};color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
        Confirmer mon e-mail</a></p>
      <p style="color:#6b7080">Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.</p>`)
  });
}

// Notification d'un nouveau message de contact (le visiteur est en « Répondre à »)
async function sendContactEmail(message) {
  const to = destinataire();
  if (!to) return;
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    replyTo: message.email,
    subject: `Nouveau message : ${message.objet_libelle || 'contact'} — ${message.nom}`.slice(0, 150),
    text: `Message de ${message.nom} (${message.email}, ${message.telephone || 'pas de téléphone'})\n` +
          `Objet : ${message.objet_libelle}\n\n${message.message}`,
    html: gabarit('Nouveau message de contact', `
      ${tableau([['Nom', message.nom], ['E-mail', message.email], ['Téléphone', message.telephone], ['Objet', message.objet_libelle]])}
      <p style="margin-top:16px;padding:12px;background:#f4f6fa;border-left:4px solid ${OR}">${avecRetours(message.message)}</p>
      <p style="color:#6b7080">Ce message est aussi disponible dans l'administration, rubrique « Messages ».</p>`)
  });
}

// Reçu envoyé au participant quand son paiement Mobile Money est confirmé
async function sendRecuPaiement(to, recu) {
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: `Paiement reçu : ${recu.jeu || 'jeu concours'} — Para'Noel`.slice(0, 150),
    text: `Votre paiement de ${recu.montant} pour « ${recu.jeu} » est confirmé (référence ${recu.reference}).\n` +
          `Répondez au questionnaire ici : ${recu.lien}`,
    html: gabarit('Paiement confirmé', `
      <p>Merci ! Votre participation est enregistrée.</p>
      ${tableau([['Jeu', recu.jeu], ['Montant', recu.montant], ['Opérateur', recu.operateur], ['Référence', recu.reference]])}
      <p style="margin-top:16px"><a href="${echapper(recu.lien)}" style="display:inline-block;padding:10px 18px;background:${ROUGE};color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
        Répondre au questionnaire</a></p>
      <p style="color:#6b7080">Le chronomètre démarre seulement quand vous cliquez sur « Commencer ». La date de la rencontre en présentiel sera publiée sur le site.</p>`)
  });
}

module.exports = { sendVerificationEmail, sendContactEmail, sendRecuPaiement, echapper };
