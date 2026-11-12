require("dotenv").config({ quiet: true });
const express = require("express");
const cors = require("cors");
const { one, many, query } = require("./db");
const { createOrder, captureOrder } = require("./paypal");
const {
  normalizeEmail,
  isValidEmail,
  createSetupToken,
  getValidToken,
  hashPassword,
  verifyPassword,
  sendSetupEmail,
  sendContactEmail,
  sendBookingPaidEmail,
  createSessionToken,
  requireAdmin,
  rateLimit,
} = require("./adminAuth");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.SITE_URL || "http://localhost:1313/luxehome")
  .trim()
  .replace(/\/$/, "");
const SALE_DEPOSIT_EUR = Number(process.env.SALE_DEPOSIT_EUR || 1000);

const allowedOrigins = String(
  process.env.ALLOWED_ORIGINS ||
    "http://localhost:1313,https://ghebre-awet-unilu.github.io",
)
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Requests without Origin (curl, server-to-server) are allowed.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
  }),
);
// 8mb so admins can store an uploaded (client-side resized) image.
app.use(express.json({ limit: "8mb" }));
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== "object") req.body = {};
  next();
});

// ---------- helpers ----------

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parsePrice(price) {
  const match = String(price || "")
    .replace(/,/g, "")
    .match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

// Rentals pay the first month's rent; sales pay a fixed reservation deposit.
function bookingAmount(property) {
  const isRent =
    property.status === "For Rent" || /month/i.test(property.price || "");
  return isRent ? parsePrice(property.price) : SALE_DEPOSIT_EUR;
}

const STATUSES = ["For Sale", "For Rent"];

function cleanProperty(body, existing = {}) {
  const pick = (key, fallback) =>
    body[key] === undefined ? fallback : body[key];

  return {
    title: String(pick("title", existing.title || "")).trim(),
    type: String(pick("type", existing.type || "")).trim(),
    status: STATUSES.includes(pick("status", existing.status))
      ? pick("status", existing.status)
      : "For Sale",
    location: String(pick("location", existing.location || "")).trim(),
    bedrooms: toInt(pick("bedrooms", existing.bedrooms)),
    bathrooms: toInt(pick("bathrooms", existing.bathrooms)),
    area: toNumber(pick("area", existing.area)),
    price: String(pick("price", existing.price || "")).trim(),
    featured: pick("featured", existing.featured) ? 1 : 0,
    description: String(pick("description", existing.description || "")),
    image_path: String(pick("image_path", existing.image_path || "")).trim(),
    video_url: String(pick("video_url", existing.video_url || "")).trim(),
  };
}

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

function serverError(res, err) {
  console.error(err);
  return fail(res, 500, "Server error. Please try again.");
}

// ---------- public ----------

app.get("/api/health", async (req, res) => {
  let db = false;
  try {
    await query("SELECT 1");
    db = true;
  } catch (err) {
    console.error("DB health check failed:", err.message);
  }
  res.json({
    ok: true,
    db,
    message: "Luxehome API is running",
    time: new Date().toISOString(),
  });
});

app.get("/api/properties", async (req, res) => {
  try {
    const properties = await many("SELECT * FROM properties ORDER BY id DESC");
    res.json({ ok: true, properties });
  } catch (err) {
    serverError(res, err);
  }
});

app.get("/api/properties/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, "Invalid property id");

    const property = await one("SELECT * FROM properties WHERE id = $1", [id]);
    if (!property) return fail(res, 404, "Property not found");

    res.json({ ok: true, property });
  } catch (err) {
    serverError(res, err);
  }
});

app.post(
  "/api/contact",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }),
  async (req, res) => {
    try {
      const firstName = String(req.body.firstName || "").trim();
      const lastName = String(req.body.lastName || "").trim();
      const email = normalizeEmail(req.body.email);
      const phone = String(req.body.phone || "").trim();
      const interest = String(req.body.interest || "").trim();
      const message = String(req.body.message || "").trim();

      if (!firstName || !lastName || !email || !message) {
        return fail(
          res,
          400,
          "First name, last name, email and message are required",
        );
      }
      if (!isValidEmail(email)) return fail(res, 400, "Invalid email address");
      if (message.length > 5000) return fail(res, 400, "Message is too long");

      await sendContactEmail({
        name: firstName + " " + lastName,
        email,
        phone,
        interest,
        message,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      fail(res, 500, "Could not send message. Please try again later.");
    }
  },
);

// ---------- booking + PayPal ----------

app.post(
  "/api/paypal/create-order",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
  async (req, res) => {
    try {
      const propertyId = parseId(req.body.property_id);
      const propertyTitle = String(req.body.property_title || "").trim();
      const guestName = String(req.body.guest_name || "").trim();
      const guestEmail = normalizeEmail(req.body.guest_email);

      if (!guestName) return fail(res, 400, "Please enter your name");
      if (!isValidEmail(guestEmail)) {
        return fail(res, 400, "Please enter a valid email address");
      }

      // The price always comes from the database, never from the browser.
      let property = null;
      if (propertyId) {
        property = await one("SELECT * FROM properties WHERE id = $1", [
          propertyId,
        ]);
      } else if (propertyTitle) {
        property = await one(
          "SELECT * FROM properties WHERE lower(title) = lower($1) ORDER BY id LIMIT 1",
          [propertyTitle],
        );
      }
      if (!property) return fail(res, 404, "Property not found");

      const amount = bookingAmount(property);
      if (!amount) return fail(res, 400, "This property has no valid price");

      const { orderId, approveUrl } = await createOrder({
        amount,
        currency: "EUR",
        description: `Booking: ${property.title}`.slice(0, 127),
        returnUrl: SITE_URL + "/success/",
        cancelUrl: SITE_URL + "/success/?cancelled=1",
      });

      if (!approveUrl) return fail(res, 502, "PayPal did not return a link");

      const booking = await one(
        `
        INSERT INTO bookings (
          property_title, guest_name, guest_email, amount, currency, status, paypal_order_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, property_title, amount, currency, status
      `,
        [
          property.title,
          guestName,
          guestEmail,
          amount,
          "EUR",
          "paypal_created",
          orderId,
        ],
      );

      res.json({ ok: true, approveUrl, booking });
    } catch (err) {
      console.error(err);
      fail(res, 502, "Could not start PayPal payment. Please try again.");
    }
  },
);

const publicBookingFields =
  "id, property_title, guest_name,guest_email , amount, currency, status, created_at";

app.post("/api/paypal/capture-order", async (req, res) => {
  try {
    const orderId = String(req.body.orderId || "").trim();
    if (!orderId) return fail(res, 400, "orderId required");

    const existing = await one(
      `SELECT ${publicBookingFields} FROM bookings WHERE paypal_order_id = $1`,
      [orderId],
    );
    if (!existing) return fail(res, 404, "Booking not found for this payment");

    // Refreshing the success page must not capture twice.
    // (No emails here: they were already sent when the payment was captured.)
    if (existing.status === "paid") {
      return res.json({ ok: true, booking: existing });
    }
    if (existing.status === "cancelled") {
      return fail(res, 400, "This booking was cancelled");
    }

    const capture = await captureOrder(orderId);
    const status = capture && capture.status;
    if (status !== "COMPLETED") {
      await query(
        `UPDATE bookings SET status = $1 WHERE paypal_order_id = $2`,
        ["payment_failed", orderId],
      );
      return fail(res, 402, "Payment was not completed by PayPal");
    }

    // "status <> 'paid'" makes sure only one request flips the booking to paid,
    // so the confirmation emails are sent exactly once.
    const booking = await one(
      `UPDATE bookings SET status = 'paid'
       WHERE paypal_order_id = $1 AND status <> 'paid'
       RETURNING ${publicBookingFields}`,
      [orderId],
    );

    if (booking) {
      // Email the customer + admin in the background so the success page
      // doesn't wait for Gmail. Failures are logged, never shown to the user.
      sendBookingPaidEmail(booking).catch((mailErr) =>
        console.error("Booking emails failed:", mailErr.message),
      );
    }

    res.json({
      ok: true,
      booking:
        booking ||
        (await one(
          `SELECT ${publicBookingFields} FROM bookings WHERE paypal_order_id = $1`,
          [orderId],
        )),
    });
  } catch (err) {
    console.error(err);
    fail(res, 502, "Could not confirm the payment with PayPal.");
  }
});

app.post("/api/paypal/cancel-order", async (req, res) => {
  try {
    const orderId = String(req.body.orderId || "").trim();
    if (!orderId) return fail(res, 400, "orderId required");

    await query(
      `UPDATE bookings SET status = 'cancelled'
       WHERE paypal_order_id = $1 AND status = 'paypal_created'`,
      [orderId],
    );
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

// ---------- admin auth ----------

app.post(
  "/api/admin/send-setup-link",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  async (req, res) => {
    try {
      // Only the configured admin can ever receive a setup link.
      const email = normalizeEmail(process.env.ADMIN_EMAIL);
      if (!email) return fail(res, 500, "ADMIN_EMAIL missing in .env");

      await query(
        `
        INSERT INTO admin_users (email, password_hash)
        VALUES ($1, NULL)
        ON CONFLICT (email) DO NOTHING
      `,
        [email],
      );

      const hours = Number(process.env.SETUP_TOKEN_HOURS || 24);
      const { token } = await createSetupToken(email, hours);
      const setupUrl = SITE_URL + "/admin/setup/?token=" + token;

      const mail = await sendSetupEmail(email, setupUrl);

      // The link itself is never returned to the browser.
      res.json({ ok: true, emailSent: mail.sent });
    } catch (err) {
      serverError(res, err);
    }
  },
);

app.post("/api/admin/setup-password", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    if (!token || password.length < 8) {
      return fail(res, 400, "Token and password (min 8 characters) required");
    }

    const checked = await getValidToken(token);
    if (!checked.ok) {
      const messages = {
        not_found: "This setup link is not valid. Request a new one.",
        already_used: "This setup link was already used. Request a new one.",
        expired: "This setup link has expired. Request a new one.",
      };
      return fail(res, 400, messages[checked.reason] || "Invalid setup link");
    }

    const row = checked.row;
    const password_hash = await hashPassword(password);
    await query(
      `
      INSERT INTO admin_users (email, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `,
      [row.email, password_hash],
    );

    await query(`UPDATE admin_setup_tokens SET used = 1 WHERE id = $1`, [
      row.id,
    ]);

    res.json({ ok: true, email: row.email });
  } catch (err) {
    serverError(res, err);
  }
});

app.post(
  "/api/admin/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = String(req.body.password || "");

      const user = await one("SELECT * FROM admin_users WHERE email = $1", [
        email,
      ]);
      const okPass =
        user && (await verifyPassword(password, user.password_hash));

      if (!okPass) return fail(res, 401, "Wrong email or password");

      const session = createSessionToken(user.email);
      res.json({ ok: true, email: user.email, ...session });
    } catch (err) {
      serverError(res, err);
    }
  },
);

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ ok: true, email: req.admin.email });
});

// ---------- admin: bookings ----------

app.get("/api/bookings", requireAdmin, async (req, res) => {
  try {
    const bookings = await many("SELECT * FROM bookings ORDER BY id DESC");
    res.json({ ok: true, bookings });
  } catch (err) {
    serverError(res, err);
  }
});

app.get("/api/bookings/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, "Invalid booking id");

    const booking = await one("SELECT * FROM bookings WHERE id = $1", [id]);
    if (!booking) return fail(res, 404, "Booking not found");

    res.json({ ok: true, booking });
  } catch (err) {
    serverError(res, err);
  }
});

// ---------- admin: properties ----------
//  added 12/11
app.post("/api/properties", requireAdmin, async (req, res) => {
  try {
    const p = cleanProperty(req.body);
    if (!p.title || !p.price) return fail(res, 400, "Title and price required");

    const property = await one(
      `
      INSERT INTO properties (
        title, type, status, location, bedrooms, bathrooms, area,
        price, featured, description, image_path, video_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `,
      [
        p.title,
        p.type,
        p.status,
        p.location,
        p.bedrooms,
        p.bathrooms,
        p.area,
        p.price,
        p.featured,
        p.description,
        p.image_path,
        p.video_url,
      ],
    );

    res.status(201).json({ ok: true, property });
  } catch (err) {
    serverError(res, err);
  }
});

app.put("/api/properties/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, "Invalid property id");

    const existing = await one("SELECT * FROM properties WHERE id = $1", [id]);
    if (!existing) return fail(res, 404, "Property not found");

    const p = cleanProperty(req.body, existing);
    if (!p.title || !p.price) return fail(res, 400, "Title and price required");

    const property = await one(
      `
      UPDATE properties SET
        title = $1, type = $2, status = $3, location = $4,
        bedrooms = $5, bathrooms = $6, area = $7, price = $8,
        featured = $9, description = $10, image_path = $11, video_url = $12
      WHERE id = $13
      RETURNING *
    `,
      [
        p.title,
        p.type,
        p.status,
        p.location,
        p.bedrooms,
        p.bathrooms,
        p.area,
        p.price,
        p.featured,
        p.description,
        p.image_path,
        p.video_url,
        id,
      ],
    );

    res.json({ ok: true, property });
  } catch (err) {
    serverError(res, err);
  }
});

app.delete("/api/properties/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, "Invalid property id");

    const result = await query("DELETE FROM properties WHERE id = $1", [id]);
    if (!result.rowCount) return fail(res, 404, "Property not found");

    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

// ---------- fallbacks ----------

app.use("/api", (req, res) => fail(res, 404, "Not found"));

// Malformed JSON, oversized bodies, etc.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return fail(res, 400, "Invalid JSON body");
  }
  if (err.type === "entity.too.large") {
    return fail(res, 413, "Request too large");
  }
  serverError(res, err);
});

app.listen(PORT, () => {
  console.log("API running at http://localhost:" + PORT);
});
