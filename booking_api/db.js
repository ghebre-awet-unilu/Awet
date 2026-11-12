require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

function sanitizeDatabaseUrl(raw) {
  if (!raw) return raw;
  let url = String(raw)
    .trim()
    .replace(/^["']|["']$/g, "");

  const match = url.match(/^(postgres(?:ql)?:\/\/[^:/?]+:)([^@]+)(@.+)$/i);
  if (!match) return url;

  const prefix = match[1];
  const password = match[2];
  const rest = match[3];

  let decoded = password;
  try {
    decoded = decodeURIComponent(password);
  } catch (_) {
    decoded = password;
  }

  return prefix + encodeURIComponent(decoded) + rest;
}

const connectionString = sanitizeDatabaseUrl(process.env.DATABASE_URL);

if (!connectionString) {
  throw new Error("DATABASE_URL missing in .env");
}

if (String(process.env.DATABASE_URL || "").includes("[YOUR-PASSWORD]")) {
  console.warn(
    "WARNING: Replace [YOUR-PASSWORD] in DATABASE_URL with your real Supabase DB password.",
  );
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function one(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

async function many(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

module.exports = { pool, query, one, many };
