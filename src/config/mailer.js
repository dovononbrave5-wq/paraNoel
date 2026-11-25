const nodemailer = require('nodemailer');

/* ---------------------------------------------------------------------
   Envoi des e-mails
   1. Brevo (recommandé) : API HTTP de Brevo, activée dès que BREVO_API_KEY est renseignée.
      L'adresse d'expédition (BREVO_SENDER_EMAIL) doit être validée dans Brevo
      (Paramètres → Expéditeurs, domaines et IP dédiées).
   2. Sinon : serveur SMTP classique (variables SMTP_*), par exemple Mailtrap en local.
   --------------------------------------------------------------------- */
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const brevoActif = () => Boolean(process.env.BREVO_API_KEY);

// Lit « Nom <adresse@site.com> » ou « adresse@site.com »
function lireExpediteur(texte) {
  const valeur = String(texte || '').trim();
  const morceaux = valeur.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  return morceaux ? { name: morceaux[1].trim(), email: morceaux[2].trim() } : { name: '', email: valeur };
}

function expediteur() {
  const depuisMailFrom = lireExpediteur(process.env.MAIL_FROM);
  return {
    name: process.env.BREVO_SENDER_NAME || depuisMailFrom.name || "Para'Noel",
    email: process.env.BREVO_SENDER_EMAIL || depuisMailFrom.email
  };
}

async function envoyerAvecBrevo({ to, subject, text, html, replyTo, pieces = [] }) {
  const corps = {
    sender: expediteur(),
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text
  };
  if (replyTo) corps.replyTo = { email: replyTo };
  // Pièces jointes (ex. formulaire PDF du jeu), encodées en base64 comme le demande Brevo
  if (pieces.length) corps.attachment = pieces.map((p) => ({ name: p.nom, content: p.contenu.toString('base64') }));

  let reponse;
  try {
    reponse = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    // Réseau coupé, pare-feu, DNS… : on précise la cause réelle
    throw new Error(`Impossible de joindre api.brevo.com (${err.cause?.code || err.name || err.message})`);
  }
  if (!reponse.ok) {
    const details = await reponse.json().catch(() => ({}));
    throw new Error(`Brevo a refusé l'envoi (${reponse.status}) : ${details.message || reponse.statusText}`);
  }
}

let transporteurSmtp = null;
function envoyerAvecSmtp({ to, subject, text, html, replyTo, pieces = [] }) {
  if (!process.env.SMTP_HOST) {
    throw new Error('Aucun service d\'e-mail configuré : renseignez BREVO_API_KEY (ou SMTP_HOST) dans .env');
  }
  transporteurSmtp ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true pour le port 465
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const attachments = pieces.map((p) => ({ filename: p.nom, content: p.contenu, contentType: 'application/pdf' }));
  return transporteurSmtp.sendMail({ from: process.env.MAIL_FROM, to, subject, text, html, replyTo, attachments });
}

// Point d'entrée unique pour tous les e-mails du site
async function envoyer(message) {
  return brevoActif() ? envoyerAvecBrevo(message) : envoyerAvecSmtp(message);
}

// Message au démarrage : indique quel service d'envoi est utilisé
function verifierConfiguration() {
  if (brevoActif()) {
    if (!expediteur().email) console.warn('Brevo : BREVO_SENDER_EMAIL manquant dans .env');
    else console.log(`E-mails envoyés avec Brevo (expéditeur : ${expediteur().email})`);
  } else if (process.env.SMTP_HOST) {
    console.log(`E-mails envoyés par SMTP (${process.env.SMTP_HOST})`);
  } else {
    console.warn('Aucun service d\'e-mail configuré : ajoutez BREVO_API_KEY dans .env');
  }
}

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
const destinataire = () => process.env.CONTACT_EMAIL || process.env.SMTP_USER || expediteur().email;

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
  await envoyer({
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
  await envoyer({
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

// Reçu envoyé au participant quand son paiement Mobile Money est confirmé.
// Présenté comme un ticket de caisse, suivi du jeu tel que l'administrateur l'a créé.
const MONO = "'Courier New',Courier,monospace";
const ligneTicket = (gauche, droite, gras = false) => `
  <tr>
    <td style="padding:3px 8px 3px 0;font-family:${MONO};font-size:14px;color:#222;white-space:nowrap;${gras ? 'font-weight:bold;' : ''}">${echapper(gauche)}</td>
    <td style="padding:3px 0;font-family:${MONO};font-size:14px;color:#222;text-align:right;white-space:nowrap;${gras ? 'font-weight:bold;' : ''}">${echapper(droite)}</td>
  </tr>`;
const separateur = (style = 'dashed') => `<tr><td colspan="2" style="padding:6px 0"><div style="border-top:1px ${style} #999"></div></td></tr>`;

function blocJeu(jeu) {
  const infos = [
    jeu.cases ? ['Cases de réponses', `${jeu.cases}`] : null,
    jeu.cloture ? ['Réponses à envoyer avant le', jeu.cloture] : null
  ].filter(Boolean);
  return `
    <h2 style="margin:0 0 8px;font-size:18px;color:${VERT}">${echapper(jeu.titre)}</h2>
    ${jeu.description ? `<p style="margin:0 0 12px">${avecRetours(jeu.description)}</p>` : ''}
    ${infos.length ? tableau(infos) : ''}
    ${jeu.reglement ? `
      <p style="margin:16px 0 6px;font-weight:bold;color:${VERT}">Règlement du jeu</p>
      <div style="padding:12px;background:#f4f6fa;border-left:4px solid ${OR};font-size:14px">${avecRetours(jeu.reglement)}</div>` : ''}`;
}

async function sendRecuPaiement(to, recu) {
  const ev = recu.evenement || {};
  const contact = [ev.telephone && `Tél. : ${ev.telephone}`, ev.whatsapp && `WhatsApp : ${ev.whatsapp}`, ev.email && `E-mail : ${ev.email}`].filter(Boolean);

  const ticket = `
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:380px;margin:0 auto 24px;background:#fff;border:1px solid #ddd;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <tr><td style="padding:22px 22px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">
        <tr><td colspan="2" style="text-align:center;font-family:${MONO};color:#222">
          <div style="font-size:18px;font-weight:bold">${echapper(ev.nom)}${ev.edition ? ` · ${echapper(ev.edition)}e édition` : ''}</div>
          ${ev.lieu ? `<div style="font-size:13px">${echapper(ev.lieu)}</div>` : ''}
          ${ev.adresse ? `<div style="font-size:13px">${echapper(ev.adresse)}</div>` : ''}
          <div style="font-size:13px;margin-top:6px">REÇU DE PAIEMENT</div>
        </td></tr>
        ${separateur()}
        ${ligneTicket('Reçu n°', recu.numero)}
        ${ligneTicket('Date', recu.date)}
        ${ligneTicket('Client', recu.client)}
        ${separateur()}
        ${ligneTicket(`1 x Participation`, recu.montant)}
        <tr><td colspan="2" style="padding:0 0 4px 18px;font-family:${MONO};font-size:13px;color:#555">« ${echapper(recu.jeu.titre)} »</td></tr>
        ${separateur()}
        <tr>
          <td style="padding:6px 0;font-family:${MONO};font-size:16px;font-weight:bold">TOTAL</td>
          <td style="padding:6px 0;font-family:${MONO};font-size:20px;font-weight:bold;text-align:right;white-space:nowrap">${echapper(recu.montant)}</td>
        </tr>
        ${separateur()}
        ${ligneTicket('Payé par', recu.operateur)}
        ${recu.telephone ? ligneTicket('Numéro', recu.telephone) : ''}
        ${recu.transaction ? ligneTicket('Transaction', recu.transaction) : ''}
        ${ligneTicket('Référence', recu.reference)}
        ${ligneTicket('Statut', 'PAYÉ')}
        ${separateur()}
        <tr><td colspan="2" style="text-align:center;font-family:${MONO};font-size:13px;color:#222;padding-top:4px">
          Merci pour votre participation !
          ${contact.map((c) => `<div style="font-size:12px;color:#555">${echapper(c)}</div>`).join('')}
        </td></tr>
      </table>
    </td></tr>
  </table>`;

  const texteContact = contact.length ? `\n${contact.join('\n')}` : '';
  await envoyer({
    to,
    subject: `Votre reçu ${recu.numero} : ${recu.jeu.titre} — ${ev.nom || "Para'Noel"}`.slice(0, 150),
    text: `REÇU DE PAIEMENT ${recu.numero} — ${recu.date}\n` +
          `1 x Participation « ${recu.jeu.titre} » : ${recu.montant}\nTOTAL : ${recu.montant}\n` +
          `Payé par : ${recu.operateur}${recu.transaction ? ` (transaction ${recu.transaction})` : ''}\nRéférence : ${recu.reference}\n\n` +
          `${recu.jeu.titre}\n${recu.jeu.description || ''}\n` +
          `${recu.jeu.cloture ? `Réponses à envoyer avant le ${recu.jeu.cloture}` : ''}\n\n` +
          `${recu.pieces?.length ? `Questionnaire joint : ${recu.pieces.map((p) => p.nom).join(', ')}\n\n` : ''}` +
          `Envoyer mes réponses : ${recu.lien}${texteContact}`,
    pieces: recu.pieces || [],
    html: gabarit('Reçu de paiement', `
      <p>Bonjour,</p>
      <p>Votre paiement est confirmé et votre participation est enregistrée. Voici votre reçu :</p>
      ${ticket}
      ${blocJeu(recu.jeu)}
      ${recu.pieces?.length ? `<p style="margin:16px 0 0;padding:12px;border:1px solid #e3e6ee;border-radius:6px"><strong>Questionnaire joint :</strong> ${recu.pieces.map((p) => echapper(p.nom)).join(', ')}<br><span style="color:#6b7080;font-size:14px">Vous le trouverez en pièce jointe de cet e-mail.</span></p>` : ''}
      <p style="margin:20px 0 8px;text-align:center"><a href="${echapper(recu.lien)}" style="display:inline-block;padding:12px 22px;background:${ROUGE};color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
        Envoyer mes réponses</a></p>
      <p style="color:#6b7080;font-size:14px">Remplissez le questionnaire PDF joint, puis envoyez vos réponses sur le site (dans les cases ou en photo). Vous pouvez les modifier jusqu'à la date de clôture. Vous retrouverez ce reçu et votre participation dans <a href="${echapper(recu.lienEspace)}" style="color:${VERT}">votre espace</a>.</p>`)
  });
}

module.exports = { sendVerificationEmail, sendContactEmail, sendRecuPaiement, echapper, verifierConfiguration };
