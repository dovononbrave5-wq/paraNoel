# Para'Noel — site de l'événement (3e édition)

Site de la fête de Noël **Para'Noel**, en Node.js, Express et MySQL :

- pages **Accueil** (édition, compte à rebours, jeux ouverts), **Jeux**, **Participer**, **Annonces**, **À propos**, **Contact** ;
- **S'inscrire / Se connecter** (e-mail, Google, Apple) et **Mon espace** ;
- **jeu concours** : questionnaire en ligne **payant par Mobile Money** (MTN MoMo, Moov Money, Celtiis Cash via **KKiaPay**),
  chronométré et corrigé automatiquement, puis **rencontre en présentiel** dont la date est publiée sur le site ;
- **tableau de bord d'administration** : jeux et questions, classement des participants, paiements, annonces, messages,
  informations de l'événement, inscrits et rôles, journal d'activité.

Tout le contenu (textes, coordonnées, édition, jeux, annonces) se saisit dans l'administration.

## Installation

Prérequis : Node.js 20 ou plus récent, MySQL 8 (ou MariaDB 10.5+).

```bash
# 1. Installer les dépendances
npm install

# 2. Créer la configuration, puis remplir SESSION_SECRET, DB_* et SMTP_*
cp .exemple.env .env

# 3. Créer la base « para_noel » et ses tables (le script peut être relancé sans risque)
mysql -u root -p < sql/schema.sql

# 4. Créer le super-administrateur (le mot de passe est demandé, sans s'afficher)
npm run creer-super-admin -- organisateur@exemple.com

# 5. Lancer le site
npm run dev        # développement
npm start          # production
```

Site : http://localhost:3000 · Administration : http://localhost:3000/admin

> Sous Windows, si `mysql` n'est pas reconnu : ouvrez `sql/schema.sql` dans MySQL Workbench
> (ou phpMyAdmin, onglet « Importer ») et exécutez-le.

## Premiers pas

1. Connectez-vous sur `/login` avec le compte super-administrateur.
2. **Informations de l'événement** : nom, numéro de l'édition (3), slogan, date et lieu de la fête
   (compte à rebours de l'accueil), coordonnées, réseaux sociaux, textes « À propos », chiffres clés.
3. **Jeux concours** → « Créer un jeu » : titre, prix en FCFA, dates d'ouverture et de clôture, durée.
   L'éditeur de questions s'ouvre ensuite : cochez la bonne réponse de chaque question.
4. Passez le jeu en « Publié » : il apparaît sur l'accueil et sur la page Jeux.
5. À la clôture : **Participants** → classement (meilleur score, puis le plus rapide) →
   « Retenir les premiers du classement » ou choix un par un.
6. Modifiez le jeu : remplissez la **rencontre en présentiel** (date, lieu, consignes) et cochez
   « Publier la rencontre ». Les participants la voient sur le site et dans leur espace.

## Le paiement Mobile Money (KKiaPay)

Le parcours d'un joueur : compte → paiement → questionnaire → rencontre.

1. Le serveur fixe le montant et crée une **référence** de paiement (le navigateur ne choisit jamais le prix).
2. La fenêtre officielle KKiaPay s'ouvre : le joueur choisit MTN, Moov ou Celtiis et valide sur son téléphone.
3. KKiaPay renvoie un identifiant de transaction. **Le serveur le vérifie lui-même auprès de KKiaPay**
   (statut réussi, montant suffisant, référence) avant de créer la participation.
   Une transaction ne peut servir qu'une fois.
4. Le **webhook** prévient aussi le serveur si le joueur ferme la page juste après avoir payé.

### Mode simulation (par défaut)

`PAIEMENT_MODE=simulation` : une fenêtre « Paiement simulé » remplace KKiaPay, aucun argent n'est débité.
Pratique pour tester tout le site. **Ce mode est refusé en production.**

### Activer KKiaPay

1. Créez un compte marchand sur kkiapay.me, puis récupérez vos clés dans **Développeurs → Clés API**.
2. Dans `.env` :

   ```
   PAIEMENT_MODE=kkiapay
   KKIAPAY_PUBLIC_KEY=...
   KKIAPAY_PRIVATE_KEY=...
   KKIAPAY_SECRET_KEY=...
   KKIAPAY_SANDBOX=true          # clés de test ; false avec les clés réelles
   KKIAPAY_WEBHOOK_SECRET=...    # le secret choisi en créant le webhook
   ```

3. Dans le tableau de bord KKiaPay, ajoutez un webhook vers
   `https://votre-domaine/api/paiements/kkiapay/webhook`, événement « transaction réussie ».
4. Testez en sandbox avec les numéros de test de KKiaPay (par exemple MTN `61000000` = paiement réussi),
   puis passez `KKIAPAY_SANDBOX=false` avec les clés réelles.

> Si la fenêtre de paiement ne s'ouvre pas, ouvrez la console du navigateur (F12) : un message
> « Content Security Policy » signale un domaine KKiaPay à autoriser dans `src/app.js` (section Helmet).

## Règles du jeu concours (appliquées par le serveur)

- Compte obligatoire, **un seul essai par compte et par jeu**.
- Le chronomètre démarre au clic sur « Commencer », côté serveur : recharger la page ne le remet pas à zéro.
- Les **bonnes réponses ne sont jamais envoyées au navigateur** ; la correction se fait sur le serveur.
- Réponses envoyées après le temps imparti (plus 30 secondes de marge) : 0 point.
- Une fois que des joueurs ont payé, le **prix** ne peut plus changer et le jeu ne peut plus être supprimé ;
  une fois qu'un joueur a commencé, les **questions** sont verrouillées.

## Les rôles

| Rôle | Peut faire |
|---|---|
| `membre` | Participer aux jeux, voir ses participations et ses résultats dans « Mon espace » |
| `admin` | Jeux et questions, classement et résultats, paiements, annonces, messages |
| `super_admin` | Tout, plus : informations de l'événement, inscrits et rôles, journal d'activité |

## Organisation du code

```
sql/schema.sql                  tables (événement, annonces, jeux, questions, paiements, participations…)
scripts/creer-super-admin.js    création du super-administrateur
src/app.js                      Express : sécurité (Helmet), sessions, routes, erreurs
src/services/kkiapay.js         vérification des paiements, webhook, mode simulation
src/models/
  jeux.model.js                 jeux, questions, participations, correction, classement
  paiements.model.js            paiements (confirmation + participation dans une transaction SQL)
  evenement.model.js            informations de l'événement
  contenus.model.js             annonces (et validation des formulaires)
src/routes/
  pages.routes.js               pages du site et /api/me
  public.routes.js              /api/public/…  (événement, annonces, jeux)
  jeux.routes.js                /api/jeux/…    parcours Participer + webhook KKiaPay
  contact.routes.js             /api/contact
  admin.routes.js               /api/admin/…   tableau de bord
src/public/                     pages HTML, CSS, JavaScript, logo (images/)
```

## Mise en ligne

- `NODE_ENV=production`, `BASE_URL=https://votre-domaine`, `PAIEMENT_MODE=kkiapay` dans `.env`.
- Le site doit être servi en **https** (cookies sécurisés, paiement).
- Sauvegardez régulièrement la base et le dossier `src/public/uploads/`.
