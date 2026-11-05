-- Tablô Abidjan — schéma PostgreSQL (exécuté automatiquement au démarrage, idempotent).

CREATE TABLE IF NOT EXISTS users (
  id        SERIAL PRIMARY KEY,
  ident     TEXT UNIQUE NOT NULL,              -- numéro (0XXXXXXXXX) ou e-mail utilisé pour se connecter
  nom       TEXT NOT NULL,
  tel       TEXT NOT NULL DEFAULT '',
  mail      TEXT NOT NULL DEFAULT '',
  com       TEXT NOT NULL DEFAULT '',          -- commune préférée
  pts       INTEGER NOT NULL DEFAULT 0 CHECK (pts >= 0),
  favs      JSONB NOT NULL DEFAULT '[]',       -- ids de restaurants
  alerts    JSONB NOT NULL DEFAULT '[]',       -- alertes de disponibilité
  redeemed  JSONB NOT NULL DEFAULT '[]',       -- récompenses échangées
  notifs    JSONB NOT NULL DEFAULT '[]',
  created   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otps (
  ident      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  sent       TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS signups (
  token    TEXT PRIMARY KEY,                   -- haché (sha256)
  ident    TEXT NOT NULL,
  expires  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id    SERIAL PRIMARY KEY,
  mail  TEXT UNIQUE NOT NULL,
  nom   TEXT NOT NULL,
  salt  TEXT NOT NULL,
  hash  TEXT NOT NULL                          -- scrypt(mot de passe, sel)
);

CREATE TABLE IF NOT EXISTS sessions (
  token    TEXT PRIMARY KEY,                   -- haché (sha256), le jeton brut n'est que dans le cookie
  kind     TEXT NOT NULL CHECK (kind IN ('user','admin')),
  sub      INTEGER NOT NULL,
  expires  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id       SERIAL PRIMARY KEY,
  code     TEXT UNIQUE NOT NULL,
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rid      TEXT NOT NULL,                      -- id du restaurant (js/data.js)
  date     TEXT NOT NULL CHECK (date ~ '^\d{4}-\d{2}-\d{2}$'),
  time     TEXT NOT NULL CHECK (time ~ '^\d{2}:\d{2}$'),
  pers     INTEGER NOT NULL CHECK (pers BETWEEN 1 AND 30),
  nom      TEXT NOT NULL,
  tel      TEXT,
  booker   TEXT,
  pay      TEXT,
  note     TEXT,
  occ      TEXT,
  pre      JSONB NOT NULL DEFAULT '[]',        -- pré-commande [{n,q}]
  exp      TEXT,
  reward   TEXT,
  status   TEXT NOT NULL CHECK (status IN ('confirmée','honorée','annulée','no-show')),
  created  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservations_rid_date ON reservations (rid, date);
CREATE INDEX IF NOT EXISTS reservations_user ON reservations (user_id);

CREATE TABLE IF NOT EXISTS reviews (
  id       SERIAL PRIMARY KEY,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rid      TEXT NOT NULL,
  nom      TEXT NOT NULL,
  date     TEXT NOT NULL,
  sc       JSONB NOT NULL,                     -- 4 notes /5
  txt      TEXT NOT NULL,
  reply    TEXT,
  created  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pro_state (
  rid      TEXT PRIMARY KEY,                   -- salle, liste d'attente, stock anti-gaspi
  data     JSONB NOT NULL,
  updated  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_fails (
  key    TEXT PRIMARY KEY,
  n      INTEGER NOT NULL,
  until  TIMESTAMPTZ NOT NULL
);

-- ---------- Établissements et rôles (super-admin Tablô / gérant de restaurant) ----------
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS tel  TEXT NOT NULL DEFAULT '';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='admins_role_check') THEN
    ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('super','gerant'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS restaurants (
  id        TEXT PRIMARY KEY,                    -- identifiant lisible (ex. "maison-kaya")
  data      JSONB NOT NULL,                      -- fiche : nom, commune, quartier, type, cuisine, budget, horaires, tables, tags, tél…
  menu      JSONB NOT NULL DEFAULT '{}',         -- { "Plats": [["Poulet braisé", 5000], …], … }
  status    TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','valide','refuse','suspendu')),
  owner_id  INTEGER REFERENCES admins(id) ON DELETE SET NULL,   -- gérant propriétaire (NULL = géré par l'équipe Tablô)
  demo      BOOLEAN NOT NULL DEFAULT false,      -- restaurant d'exemple (notes et avis fictifs)
  contact   JSONB NOT NULL DEFAULT '{}',         -- RCCM, gérant, e-mail, téléphone
  created   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurants_status ON restaurants (status);
CREATE INDEX IF NOT EXISTS restaurants_owner  ON restaurants (owner_id);

-- ---------- Parcours d'inscription, disponibilités réelles, photos ----------
DROP INDEX IF EXISTS one_confirmed_per_slot;      -- remplacé par l'attribution de tables
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS tables JSONB NOT NULL DEFAULT '[]';
ALTER TABLE restaurants  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'essentiel';
ALTER TABLE restaurants  ADD COLUMN IF NOT EXISTS submitted BOOLEAN NOT NULL DEFAULT false;  -- fiche complète envoyée pour publication

CREATE TABLE IF NOT EXISTS leads (                -- demandes de contact des restaurants
  id       SERIAL PRIMARY KEY,
  resto    TEXT NOT NULL, commune TEXT NOT NULL, type TEXT NOT NULL,
  gerant   TEXT NOT NULL, tel TEXT NOT NULL, mail TEXT NOT NULL,
  tables   INTEGER, plan TEXT NOT NULL DEFAULT 'essentiel', message TEXT NOT NULL DEFAULT '',
  notes    TEXT NOT NULL DEFAULT '',
  status   TEXT NOT NULL DEFAULT 'nouveau' CHECK (status IN ('nouveau','contacte','compte_cree','refuse')),
  rid      TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
  created  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activations (          -- liens d'activation des comptes gérants (hachés)
  token     TEXT PRIMARY KEY,
  admin_id  INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires   TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS restaurant_photos (
  id       SERIAL PRIMARY KEY,
  rid      TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  mime     TEXT NOT NULL,
  bytes    BYTEA NOT NULL,
  pos      INTEGER NOT NULL DEFAULT 0,
  created  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_photos_rid ON restaurant_photos (rid);

-- ---------- Rappels et offres anti-gaspi ----------
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminded BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS retraits (             -- portions anti-gaspi réservées, payées au retrait
  id       SERIAL PRIMARY KEY,
  code     TEXT UNIQUE NOT NULL,
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rid      TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  plat     TEXT NOT NULL,
  prix     INTEGER NOT NULL,
  date     TEXT NOT NULL,
  nom      TEXT NOT NULL,
  tel      TEXT NOT NULL DEFAULT '',
  status   TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','retiré','annulé')),
  created  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retraits_rid_date ON retraits (rid, date);

-- ---------- Entretien obligatoire avant la création du compte d'un gérant ----------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entretien_at TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entretien_lieu TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entretien_mode TEXT NOT NULL DEFAULT 'sur_place';
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN ('nouveau','contacte','entretien','entretien_fait','compte_cree','refuse'));
