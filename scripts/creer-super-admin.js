// Crée le super-administrateur (un seul autorisé), ou promeut un compte existant.
// Usage :  npm run creer-super-admin -- patron@exemple.com
//          (le mot de passe est demandé, sans s'afficher à l'écran)
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Même règle que l'inscription (validate.js)
const REGEX_MOT_DE_PASSE = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,72}$/;

// Demande un texte ; masqué par des « * » quand on tape dans un terminal
function demander(question, masque = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (masque && process.stdin.isTTY) {
      rl._writeToOutput = (texte) => {
        rl.output.write(texte.includes(question) ? texte : '*'.repeat(texte.length ? 1 : 0));
      };
    }
    rl.question(question, (reponse) => {
      rl.close();
      if (masque && process.stdin.isTTY) process.stdout.write('\n');
      resolve(reponse);
    });
  });
}

async function journaliser(user, detail) {
  await db.execute(
    "INSERT INTO journal_activite (user_id, email, action, detail) VALUES (?, ?, 'role', ?)",
    [user.id, user.email, detail]
  );
}

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!REGEX_EMAIL.test(email)) {
    console.error('Indiquez une adresse e-mail valide.');
    console.error('Usage : npm run creer-super-admin -- patron@exemple.com');
    process.exitCode = 1;
    return;
  }

  // 1. Un seul super-administrateur autorisé
  const [supers] = await db.execute("SELECT id, email FROM users WHERE role = 'super_admin'");
  if (supers.length > 0) {
    if (supers[0].email === email) console.log(`${email} est déjà le super-administrateur. Rien à faire.`);
    else {
      console.error(`Refusé : un super-administrateur existe déjà (${supers[0].email}). Un seul est autorisé.`);
      process.exitCode = 1;
    }
    return;
  }

  // 2. Le compte existe déjà (inscrit par le site, Google ou Apple) : on le promeut
  const [existants] = await db.execute('SELECT id, email FROM users WHERE email = ?', [email]);
  if (existants.length > 0) {
    await db.execute(
      "UPDATE users SET role = 'super_admin', is_verified = 1, statut = 'actif' WHERE id = ?",
      [existants[0].id]
    );
    await journaliser(existants[0], `${email} promu super-administrateur (script)`);
    console.log(`Compte existant promu super-administrateur : ${email}`);
    return;
  }

  // 3. Nouveau compte : mot de passe demandé deux fois, haché avec bcrypt
  const motDePasse = await demander('Mot de passe du super-administrateur : ', true);
  if (!REGEX_MOT_DE_PASSE.test(motDePasse)) {
    console.error('Mot de passe refusé : 8 à 72 caractères, avec une majuscule, une minuscule, un chiffre et un caractère spécial.');
    process.exitCode = 1;
    return;
  }
  if (process.stdin.isTTY) {
    const confirmation = await demander('Confirmez le mot de passe : ', true);
    if (confirmation !== motDePasse) {
      console.error('Les deux mots de passe ne correspondent pas.');
      process.exitCode = 1;
      return;
    }
  }

  const hash = await bcrypt.hash(motDePasse, 12);
  const [resultat] = await db.execute(
    "INSERT INTO users (email, password_hash, is_verified, role) VALUES (?, ?, 1, 'super_admin')",
    [email, hash]
  );
  await journaliser({ id: resultat.insertId, email }, `${email} créé super-administrateur (script)`);
  console.log(`Super-administrateur créé : ${email}. Connectez-vous sur /login.`);
}

main()
  .catch((err) => {
    console.error('Erreur :', err.code === 'ER_NO_SUCH_TABLE'
      ? 'les tables n\'existent pas. Exécutez d\'abord sql/schema.sql.'
      : err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
