-- =====================================================================
--  Para'Noel — schéma de la base de données (MySQL 8 / MariaDB 10.5+)
--  Exécution :  mysql -u root -p < sql/schema.sql
--  Le script peut être relancé sans risque : il ne supprime rien.
-- =====================================================================

-- Lit ce fichier en UTF-8 (sinon les accents sont abîmés)
SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS para_noel
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE para_noel;
-- ---------------------------------------------------------------------
--  Comptes : membres (participants), administrateurs, super-administrateur
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  email              VARCHAR(254) NOT NULL,
  password_hash      VARCHAR(255) DEFAULT NULL,          -- NULL pour un compte Google/Apple
  is_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  google_id          VARCHAR(255) DEFAULT NULL,
  apple_id           VARCHAR(255) DEFAULT NULL,
  role               ENUM('membre', 'admin', 'super_admin') NOT NULL DEFAULT 'membre',
  statut             ENUM('actif', 'suspendu') NOT NULL DEFAULT 'actif',
  date_inscription   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  derniere_connexion DATETIME DEFAULT NULL,

  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_google (google_id),
  UNIQUE KEY uq_users_apple (apple_id),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,

  UNIQUE KEY uq_token_hash (token_hash),
  CONSTRAINT fk_email_verification_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inscriptions en attente : l'e-mail n'entre dans « users » qu'après confirmation
-- (cette table est aussi créée automatiquement au démarrage du serveur)
CREATE TABLE IF NOT EXISTS inscriptions_en_attente (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  token_hash    CHAR(64) NOT NULL,
  expires_at    DATETIME NOT NULL,
  cree_le       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_attente_email (email),
  UNIQUE KEY uq_attente_token (token_hash),
  INDEX idx_attente_expiration (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Informations de l'événement : une seule ligne (id = 1),
--  modifiable uniquement par le super-administrateur
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evenement (
  id                 INT PRIMARY KEY,
  nom                VARCHAR(150) NOT NULL,
  edition            TINYINT UNSIGNED NOT NULL DEFAULT 3, -- numéro de l'édition affiché sur l'accueil
  annee              SMALLINT DEFAULT NULL,
  slogan             VARCHAR(255) DEFAULT NULL,
  devise             VARCHAR(100) DEFAULT NULL,
  presentation       TEXT DEFAULT NULL,
  description_courte TEXT DEFAULT NULL,
  date_evenement     DATETIME DEFAULT NULL,              -- compte à rebours de l'accueil
  lieu               VARCHAR(200) DEFAULT NULL,

  telephone          VARCHAR(30)  DEFAULT NULL,
  whatsapp           VARCHAR(30)  DEFAULT NULL,
  email              VARCHAR(254) DEFAULT NULL,
  adresse            TEXT DEFAULT NULL,
  horaires           TEXT DEFAULT NULL,

  carte_url          TEXT DEFAULT NULL,
  lien_itineraire    TEXT DEFAULT NULL,
  facebook           TEXT DEFAULT NULL,
  instagram          TEXT DEFAULT NULL,
  tiktok             TEXT DEFAULT NULL,

  histoire           TEXT DEFAULT NULL,
  mission            TEXT DEFAULT NULL,
  vision             TEXT DEFAULT NULL,
  engagement         TEXT DEFAULT NULL,
  image_apropos      VARCHAR(255) DEFAULT NULL,

  chiffres           TEXT DEFAULT NULL,                  -- tableau JSON [{valeur, suffixe, libelle}]

  modifie_le         DATETIME DEFAULT NULL,
  modifie_par        INT DEFAULT NULL,

  CONSTRAINT fk_evenement_modifie_par
    FOREIGN KEY (modifie_par) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- INSERT IGNORE : ne fait rien si la ligne existe déjà (script relançable)
INSERT IGNORE INTO evenement (id, nom, edition, devise)
VALUES (1, 'Para''Noel', 3, 'Jouer • Partager • Célébrer');

-- ---------------------------------------------------------------------
--  Annonces (programme, actualités, informations sur les jeux)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS annonces (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ordre            INT NOT NULL DEFAULT 0,
  type             ENUM('actualite', 'programme', 'jeu', 'resultats') NOT NULL,
  titre            VARCHAR(200) NOT NULL,
  lieu             VARCHAR(150) DEFAULT NULL,
  description      TEXT DEFAULT NULL,
  date_publication DATETIME DEFAULT NULL,
  date_expiration  DATETIME DEFAULT NULL,
  lien             VARCHAR(500) DEFAULT NULL,
  texte_lien       VARCHAR(150) DEFAULT NULL,
  statut           ENUM('brouillon', 'publiee') NOT NULL DEFAULT 'brouillon',
  cree_le          DATETIME DEFAULT CURRENT_TIMESTAMP,
  modifie_le       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Galerie des éditions passées (photos ajoutées par le super-administrateur)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS galerie_photos (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  edition  TINYINT UNSIGNED NOT NULL,
  annee    SMALLINT DEFAULT NULL,
  legende  VARCHAR(150) DEFAULT NULL,
  image    VARCHAR(255) NOT NULL,
  cree_le  DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_galerie_edition (edition, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Jeux concours : un questionnaire payant en ligne,
--  puis une rencontre en présentiel (test de compétences)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jeux (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  titre            VARCHAR(150) NOT NULL,
  description      TEXT DEFAULT NULL,
  reglement        TEXT DEFAULT NULL,
  image            VARCHAR(255) DEFAULT NULL,
  formulaire_pdf   VARCHAR(64)  DEFAULT NULL,          -- PDF joint au reçu (dossier privé prive/formulaires)
  formulaire_nom   VARCHAR(150) DEFAULT NULL,          -- nom du PDF affiché dans l'e-mail
  prix             INT UNSIGNED NOT NULL,                -- en francs CFA
  date_ouverture   DATETIME NOT NULL,                    -- le questionnaire est accessible entre ces deux dates
  date_cloture     DATETIME NOT NULL,
  duree_minutes    SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  statut           ENUM('brouillon', 'publie') NOT NULL DEFAULT 'brouillon',
  rencontre_date   DATETIME DEFAULT NULL,                -- test de compétences en présentiel
  rencontre_lieu   VARCHAR(200) DEFAULT NULL,
  rencontre_infos  TEXT DEFAULT NULL,
  rencontre_publiee BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le          DATETIME DEFAULT CURRENT_TIMESTAMP,
  modifie_le       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_jeux_statut (statut, date_ouverture)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  jeu_id        INT NOT NULL,
  ordre         INT NOT NULL DEFAULT 0,
  intitule      VARCHAR(500) NOT NULL,
  choix         TEXT NOT NULL,                           -- tableau JSON de 2 à 6 réponses possibles
  bonne_reponse TINYINT UNSIGNED NOT NULL,               -- position de la bonne réponse (0 = la première) : jamais envoyée au navigateur
  points        TINYINT UNSIGNED NOT NULL DEFAULT 1,

  INDEX idx_questions_jeu (jeu_id, ordre),
  CONSTRAINT fk_question_jeu FOREIGN KEY (jeu_id) REFERENCES jeux(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Paiements Mobile Money (KKiaPay : MTN, Moov, Celtiis)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paiements (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reference      CHAR(32) NOT NULL,                      -- notre référence, transmise à KKiaPay (partnerId)
  user_id        INT DEFAULT NULL,
  jeu_id         INT DEFAULT NULL,
  montant        INT UNSIGNED NOT NULL,
  fournisseur    ENUM('kkiapay', 'simulation') NOT NULL,
  statut         ENUM('en_attente', 'reussi', 'echoue') NOT NULL DEFAULT 'en_attente',
  transaction_id VARCHAR(100) DEFAULT NULL,              -- identifiant KKiaPay, vérifié côté serveur
  operateur      VARCHAR(50) DEFAULT NULL,               -- mtn-benin, moov-benin, celtiis…
  telephone      VARCHAR(30) DEFAULT NULL,
  motif_echec    VARCHAR(255) DEFAULT NULL,
  cree_le        DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirme_le    DATETIME DEFAULT NULL,

  UNIQUE KEY uq_paiement_reference (reference),
  UNIQUE KEY uq_paiement_transaction (transaction_id),   -- une transaction ne paie qu'une seule fois
  INDEX idx_paiement_statut (statut),
  CONSTRAINT fk_paiement_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_paiement_jeu FOREIGN KEY (jeu_id) REFERENCES jeux(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une participation = un compte, un jeu, un paiement réussi, un seul essai au questionnaire
CREATE TABLE IF NOT EXISTS participations (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  jeu_id       INT NOT NULL,
  user_id      INT NOT NULL,
  paiement_id  INT DEFAULT NULL,
  statut       ENUM('payee', 'en_cours', 'terminee') NOT NULL DEFAULT 'payee',
  debut_le     DATETIME DEFAULT NULL,
  fin_le       DATETIME DEFAULT NULL,
  reponses     TEXT DEFAULT NULL,                        -- JSON {idQuestion: positionChoisie}
  score        SMALLINT UNSIGNED DEFAULT NULL,
  total        SMALLINT UNSIGNED DEFAULT NULL,
  resultat     ENUM('en_attente', 'retenu', 'non_retenu') NOT NULL DEFAULT 'en_attente',
  cree_le      DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_participation (jeu_id, user_id),
  CONSTRAINT fk_participation_jeu FOREIGN KEY (jeu_id) REFERENCES jeux(id) ON DELETE CASCADE,
  CONSTRAINT fk_participation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_participation_paiement FOREIGN KEY (paiement_id) REFERENCES paiements(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Messages du formulaire de contact
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages_contact (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  nom       VARCHAR(150) NOT NULL,
  email     VARCHAR(254) NOT NULL,
  telephone VARCHAR(30)  DEFAULT NULL,
  objet     VARCHAR(50)  DEFAULT NULL,
  message   TEXT NOT NULL,
  statut    ENUM('nouveau', 'traite') NOT NULL DEFAULT 'nouveau',
  ip        VARCHAR(45) DEFAULT NULL,
  date      DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_messages_statut (statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Journal d'activité (suivi par le super-administrateur)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_activite (
  id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  email   VARCHAR(254) DEFAULT NULL,
  action  VARCHAR(50) NOT NULL,
  detail  TEXT DEFAULT NULL,
  ip      VARCHAR(45) DEFAULT NULL,
  date    DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_journal_date (date),
  INDEX idx_journal_action (action),
  CONSTRAINT fk_journal_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La table des sessions (« sessions ») est créée automatiquement
-- par express-mysql-session au premier démarrage du serveur.
