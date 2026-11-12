-- LuxeHome database schema (Supabase / PostgreSQL).
-- Run once in Supabase -> SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS properties (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  type        TEXT,
  status      TEXT,
  location    TEXT,
  bedrooms    INTEGER,
  bathrooms   INTEGER,
  area        DOUBLE PRECISION,
  price       TEXT,
  featured    INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  image_path  TEXT,
  video_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id              BIGSERIAL PRIMARY KEY,
  property_title  TEXT NOT NULL,
  guest_name      TEXT NOT NULL,
  guest_email     TEXT NOT NULL,
  amount          DOUBLE PRECISION NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  -- paypal_created | paid | cancelled | payment_failed
  status          TEXT NOT NULL DEFAULT 'pending',
  paypal_order_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_setup_tokens (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The API connects with the database password, so it is not affected by RLS.
-- Enabling RLS blocks direct access through Supabase's public REST API.
ALTER TABLE properties         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_setup_tokens ENABLE ROW LEVEL SECURITY;
