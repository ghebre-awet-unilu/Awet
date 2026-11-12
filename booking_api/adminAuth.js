const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { one, query } = require("./db");

const SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 8);

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- password setup tokens ----------

async function createSetupToken(email, hours) {
  const h = Number(hours);
  const safeHours = Number.isFinite(h) && h > 0 ? h : 24;
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + safeHours * 60 * 60 * 1000,
  ).toISOString();

  await query(
    `
    INSERT INTO admin_setup_tokens (email, token, expires_at)
    VALUES ($1, $2, $3)
  `,
    [normalizeEmail(email), token, expiresAt],
  );

  return { token, expiresAt };
}

async function findSetupToken(token) {
  const clean = String(token || "").trim();
  if (!clean) return null;
  return one(`SELECT * FROM admin_setup_tokens WHERE token = $1`, [clean]);
}

async function getValidToken(token) {
  const row = await findSetupToken(token);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.used) return { ok: false, reason: "already_used" };

  const exp = new Date(row.expires_at);
  if (Number.isNaN(exp.getTime()) || exp.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, row };
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

// ---------- admin sessions (signed tokens, no extra DB table) ----------

function sessionSecret() {
  const secret = String(process.env.ADMIN_SESSION_SECRET || "").trim();
  if (secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET missing or too short in .env");
  }
  return secret;
}

function sign(payload) {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

function createSessionToken(email) {
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = Buffer.from(
    JSON.stringify({ email: normalizeEmail(email), exp: expiresAt }),
  ).toString("base64url");
  return { token: payload + "." + sign(payload), expiresAt };
}

function verifySessionToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (
    expected.length !== given.length ||
    !crypto.timingSafeEqual(expected, given)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.email || !data.exp || data.exp <= Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = verifySessionToken(token);
  if (!session) {
    return res
      .status(401)
      .json({ ok: false, error: "Please log in as admin again" });
  }
  req.admin = session;
  next();
}

// ---------- simple in-memory rate limiter ----------

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return function (req, res, next) {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({
        ok: false,
        error: "Too many attempts. Please wait a few minutes and try again.",
      });
    }
    next();
  };
}

// ---------- email ----------

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST.trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: process.env.SMTP_PASS.trim(),
    },
  });
}

function mailFrom() {
  return (process.env.MAIL_FROM || process.env.SMTP_USER).trim();
}

async function sendSetupEmail(to, setupUrl) {
  if (!smtpConfigured()) {
    console.log("SETUP LINK (SMTP not fully set):", setupUrl);
    return { sent: false };
  }

  try {
    await createTransporter().sendMail({
      from: mailFrom(),
      to,
      subject: "Set your LuxeHome admin password",
      text: `Open this link to set your password (expires soon):\n\n${setupUrl}`,
      html: `<p>Set your admin password:</p><p><a href="${setupUrl}">${setupUrl}</a></p><p>This link expires soon.</p>`,
    });
    return { sent: true };
  } catch (err) {
    console.error("SMTP send failed:", err.message);
    console.log("SETUP LINK (use this URL):", setupUrl);
    return { sent: false };
  }
}

async function sendContactEmail({ name, email, phone, interest, message }) {
  if (!smtpConfigured()) throw new Error("SMTP not configured in .env");

  const text =
    `Name: ${name}\nEmail: ${email}\nPhone: ${phone || "-"}\n` +
    `Interested in: ${interest || "-"}\n\n${message}`;

  await createTransporter().sendMail({
    from: mailFrom(),
    to: (process.env.ADMIN_EMAIL || process.env.SMTP_USER).trim(),
    replyTo: email,
    subject: `New LuxeHome enquiry from ${name}`,
    text,
    html: `<pre style="font-family:inherit">${escapeHtml(text)}</pre>`,
  });
}

// ---------- booking confirmation emails ----------

// Sent once, right after PayPal confirms the payment:
//  1. a confirmation to the customer
//  2. a notification to the admin (ADMIN_EMAIL)
async function sendBookingPaidEmail(booking) {
  if (!smtpConfigured()) {
    console.log("Booking paid (SMTP not set, no emails sent):", booking);
    return { customerSent: false, adminSent: false };
  }

  const transporter = createTransporter();
  const currency = booking.currency || "EUR";
  const paidAt = new Date(booking.created_at || Date.now()).toLocaleString(
    "en-GB",
  );

  // 1. Customer confirmation
  const customerEmail = String(booking.guest_email || "").trim();
  const customerText =
    `Hi ${booking.guest_name || "there"},\n\n` +
    `Thank you for your payment. Your booking is confirmed.\n\n` +
    `Property: ${booking.property_title}\n` +
    `Amount paid: ${booking.amount} ${currency}\n` +
    `Booking ID: ${booking.id}\n\n` +
    `We will contact you soon with the next steps.\n\n` +
    `- LuxeHome`;

  // 2. Admin notification
  const adminEmail = String(
    process.env.ADMIN_EMAIL || process.env.SMTP_USER || "",
  ).trim();
  const adminText =
    `A new booking has been paid.\n\n` +
    `Customer name: ${booking.guest_name}\n` +
    `Customer email: ${customerEmail || "-"}\n` +
    `Property: ${booking.property_title}\n` +
    `Amount paid: ${booking.amount} ${currency}\n` +
    `Booking ID: ${booking.id}\n` +
    `Booked on: ${paidAt}`;

  const jobs = [
    customerEmail
      ? transporter.sendMail({
          from: mailFrom(),
          to: customerEmail,
          subject: `Booking confirmed: ${booking.property_title}`,
          text: customerText,
          html: `<pre style="font-family:inherit">${escapeHtml(customerText)}</pre>`,
        })
      : Promise.reject(new Error("booking has no guest email")),
    adminEmail
      ? transporter.sendMail({
          from: mailFrom(),
          to: adminEmail,
          replyTo: customerEmail || undefined,
          subject: `New booking by ${booking.guest_name}: ${booking.property_title}`,
          text: adminText,
          html: `<pre style="font-family:inherit">${escapeHtml(adminText)}</pre>`,
        })
      : Promise.reject(new Error("ADMIN_EMAIL missing in .env")),
  ];

  const [customer, admin] = await Promise.allSettled(jobs);
  if (customer.status === "rejected") {
    console.error("Customer booking email failed:", customer.reason.message);
  }
  if (admin.status === "rejected") {
    console.error("Admin booking email failed:", admin.reason.message);
  }

  return {
    customerSent: customer.status === "fulfilled",
    adminSent: admin.status === "fulfilled",
  };
}

module.exports = {
  normalizeEmail,
  isValidEmail,
  createSetupToken,
  getValidToken,
  findSetupToken,
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  requireAdmin,
  rateLimit,
  sendSetupEmail,
  sendContactEmail,
  sendBookingPaidEmail,
};
